import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WorkspaceDisplayProvider } from "./hooks/useWorkspaceDisplay";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WorkspaceDisplayProvider>
      <App />
    </WorkspaceDisplayProvider>
  </React.StrictMode>,
);
