import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./hooks/useTheme";
import { WorkspaceDisplayProvider } from "./hooks/useWorkspaceDisplay";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <WorkspaceDisplayProvider>
        <App />
      </WorkspaceDisplayProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
