import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConfig = JSON.parse(
  readFileSync("src-tauri/tauri.conf.json", "utf8"),
);
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoToml.match(
  /^\s*version\s*=\s*"([^"]+)"\s*$/m,
)?.[1];

const versions = {
  package: packageJson.version,
  cargo: cargoVersion,
  tauri: tauriConfig.version,
};
const uniqueVersions = new Set(Object.values(versions));

if (uniqueVersions.size !== 1 || uniqueVersions.has(undefined)) {
  console.error("Version mismatch:", versions);
  process.exit(1);
}

const releaseTag = process.env.RELEASE_TAG;
const version = packageJson.version;
if (releaseTag && releaseTag !== `v${version}`) {
  console.error(
    `Release tag ${releaseTag} does not match project version v${version}.`,
  );
  process.exit(1);
}

console.log(`Version ${version} is consistent across npm, Cargo, and Tauri.`);
