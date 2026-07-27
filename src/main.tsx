import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { hydratePersistentStorage } from "./lib/persistence";
import "./styles.css";

void hydratePersistentStorage().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
