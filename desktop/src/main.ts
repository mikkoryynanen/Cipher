import { createTauriApi } from "./api";
import "./style.css";
import { App } from "./ui/app";

const root = document.getElementById("app");
if (root) void new App(root, createTauriApi()).start();
