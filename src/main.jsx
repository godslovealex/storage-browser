import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import StorageBrowser from "./storage-browser.jsx";

// Mock for window.storage (only exists in Claude Artifacts)
window.storage = {
  get: async (key) => {
    try {
      return { value: localStorage.getItem(key) };
    } catch {
      return null;
    }
  },
  set: async (key, value) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      // localStorage unavailable
      return false;
    }
  },
  delete: async (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage unavailable
    }
  },
};

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <StorageBrowser />
  </StrictMode>,
);
