#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const projectRoot = path.resolve(__dirname, "..");
const requiredPaths = [
  "backend/server.js",
  "frontend/index.html",
  "frontend/app.js",
  "frontend/styles.css",
];

function ensureRequiredPath(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required project file: ${relativePath}`);
  }
}

function collectJavaScriptFiles(relativeDir) {
  const absoluteDir = path.join(projectRoot, relativeDir);

  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      return collectJavaScriptFiles(relativePath);
    }

    return entry.name.endsWith(".js") ? [relativePath] : [];
  });
}

function checkJavaScriptSyntax(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");

  new vm.Script(source, { filename: absolutePath });
}

try {
  requiredPaths.forEach(ensureRequiredPath);

  const javaScriptFiles = [
    ...collectJavaScriptFiles("backend"),
    ...collectJavaScriptFiles("frontend"),
  ].sort();

  javaScriptFiles.forEach(checkJavaScriptSyntax);

  console.log(
    `Build validation passed for ${javaScriptFiles.length} JavaScript files.`
  );
} catch (error) {
  if (error.stderr) {
    process.stderr.write(error.stderr.toString());
  } else {
    process.stderr.write(`${error.message}\n`);
  }

  process.exit(1);
}
