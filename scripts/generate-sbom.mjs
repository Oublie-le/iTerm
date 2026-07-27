import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  repositoryRoot,
  argumentValue("--output") ?? "dist/iTerm.cdx.json",
);
const packageDocument = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);

const npmLicenses = installedNpmLicenses();
const npmComponents = parsePnpmPackages().map(({ name, version }) =>
  createComponent("npm", name, version, npmLicenses.get(`${name}@${version}`)),
);
const cargoComponents = parseCargoPackages().map((pkg) =>
  createComponent("cargo", pkg.name, pkg.version, undefined, pkg.checksum),
);
const components = deduplicateAndSort([...npmComponents, ...cargoComponents]);
const applicationPurl = `pkg:generic/${packageDocument.name}@${packageDocument.version}`;
const fingerprint = createHash("sha256")
  .update(
    [applicationPurl, ...components.map((component) => component.purl)].join(
      "\n",
    ),
  )
  .digest("hex");

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${uuidFromHash(fingerprint)}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: {
      components: [
        {
          type: "application",
          name: "iTerm SBOM generator",
          version: "1",
        },
      ],
    },
    component: {
      type: "application",
      "bom-ref": applicationPurl,
      name: packageDocument.name,
      version: packageDocument.version,
      purl: applicationPurl,
    },
  },
  components,
};

validateBom(bom);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`);
console.log(
  `Generated ${outputPath} with ${npmComponents.length} npm and ${cargoComponents.length} Cargo components.`,
);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path.`);
  }
  return value;
}

function parsePnpmPackages() {
  const lockfile = readFileSync(join(repositoryRoot, "pnpm-lock.yaml"), "utf8");
  const packagesStart = lockfile.indexOf("\npackages:\n");
  const snapshotsStart = lockfile.indexOf("\nsnapshots:\n");
  if (packagesStart === -1 || snapshotsStart === -1) {
    throw new Error("pnpm-lock.yaml does not contain packages and snapshots sections.");
  }

  const packageKeys = [];
  const section = lockfile.slice(packagesStart + 11, snapshotsStart);
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(
      /^ {2}(?:'([^']+)'|([^\s:'"][^:]*)):\s*$/,
    );
    const key = match?.[1] ?? match?.[2];
    if (!key) continue;
    const separator = key.lastIndexOf("@");
    if (separator <= 0 || separator === key.length - 1) {
      throw new Error(`Unsupported pnpm package key: ${key}`);
    }
    packageKeys.push({
      name: key.slice(0, separator),
      version: key.slice(separator + 1),
    });
  }
  if (packageKeys.length === 0) {
    throw new Error("No npm packages were found in pnpm-lock.yaml.");
  }
  return packageKeys;
}

function installedNpmLicenses() {
  const storePath = join(repositoryRoot, "node_modules", ".pnpm");
  const licenses = new Map();
  for (const storeEntry of safeReadDirectory(storePath)) {
    const modulesPath = join(storePath, storeEntry, "node_modules");
    for (const name of safeReadDirectory(modulesPath)) {
      if (name.startsWith("@")) {
        const scopePath = join(modulesPath, name);
        for (const scopedName of safeReadDirectory(scopePath)) {
          readNpmLicense(join(scopePath, scopedName), licenses);
        }
      } else {
        readNpmLicense(join(modulesPath, name), licenses);
      }
    }
  }
  return licenses;
}

function safeReadDirectory(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function readNpmLicense(packagePath, licenses) {
  try {
    const pkg = JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8"));
    const license =
      typeof pkg.license === "string"
        ? pkg.license
        : Array.isArray(pkg.licenses)
          ? pkg.licenses
              .map((entry) =>
                typeof entry === "string" ? entry : entry?.type,
              )
              .filter(Boolean)
              .join(" OR ")
          : undefined;
    if (typeof pkg.name === "string" && typeof pkg.version === "string") {
      licenses.set(`${pkg.name}@${pkg.version}`, license);
    }
  } catch {
    // Optional packages for other platforms might not be installed locally.
  }
}

function parseCargoPackages() {
  const lockfile = readFileSync(
    join(repositoryRoot, "src-tauri", "Cargo.lock"),
    "utf8",
  );
  return lockfile
    .split("[[package]]")
    .slice(1)
    .map((block) => {
      const name = tomlString(block, "name");
      const version = tomlString(block, "version");
      const checksum = tomlString(block, "checksum");
      const source = tomlString(block, "source");
      if (!name || !version) {
        throw new Error("Cargo.lock contains an incomplete package entry.");
      }
      return { name, version, checksum, source };
    })
    .filter(
      (pkg) => pkg.name !== packageDocument.name || pkg.source !== undefined,
    );
}

function tomlString(block, key) {
  return block.match(new RegExp(`^${key} = "([^"]+)"$`, "m"))?.[1];
}

function createComponent(ecosystem, name, version, license, checksum) {
  const purlName =
    ecosystem === "npm"
      ? name
          .split("/")
          .map((part) => encodeURIComponent(part))
          .join("/")
      : encodeURIComponent(name);
  const purl = `pkg:${ecosystem}/${purlName}@${encodeURIComponent(version)}`;
  return {
    type: "library",
    "bom-ref": purl,
    name,
    version,
    purl,
    ...(license ? { licenses: [{ expression: license }] } : {}),
    ...(checksum
      ? { hashes: [{ alg: "SHA-256", content: checksum }] }
      : {}),
    properties: [{ name: "iterm:ecosystem", value: ecosystem }],
  };
}

function deduplicateAndSort(components) {
  return [
    ...new Map(components.map((component) => [component.purl, component])).values(),
  ].sort((left, right) => left.purl.localeCompare(right.purl));
}

function uuidFromHash(hash) {
  const bytes = hash.slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = ((Number.parseInt(bytes[16], 16) & 0x3) | 0x8).toString(16);
  const value = bytes.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join("-");
}

function validateBom(value) {
  if (
    value.bomFormat !== "CycloneDX" ||
    value.specVersion !== "1.5" ||
    !Array.isArray(value.components) ||
    value.components.length === 0
  ) {
    throw new Error("Generated CycloneDX document is incomplete.");
  }
  const refs = new Set();
  for (const component of value.components) {
    if (!component.name || !component.version || !component.purl) {
      throw new Error("Generated CycloneDX component is incomplete.");
    }
    if (refs.has(component["bom-ref"])) {
      throw new Error(`Duplicate CycloneDX component: ${component["bom-ref"]}`);
    }
    refs.add(component["bom-ref"]);
  }
}
