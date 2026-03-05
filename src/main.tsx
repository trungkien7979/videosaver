console.log("main.tsx: Starting...");
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { BrowserRouter } from "react-router-dom";

const rootElement = document.getElementById("root");
console.log("main.tsx: Root element:", rootElement);

if (rootElement) {
  createRoot(rootElement).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  );
  console.log("main.tsx: Render called");
} else {
  console.error("main.tsx: Root element not found!");
}
