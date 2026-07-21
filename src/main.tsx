import React from "react";
import ReactDOM from "react-dom/client";
import { CadreApp } from "./cadre/CadreApp";
import "./index.css";
import "./styles/tokens.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CadreApp />
  </React.StrictMode>,
);
