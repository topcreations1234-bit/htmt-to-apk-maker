
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");

const run = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  dest: path.join(os.tmpdir(), "apk-uploads"),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.originalname.toLowerCase().endsWith(".html"));
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/build", upload.single("html"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Upload index.html first." });
  }

  const name = String(req.body.appName || "My HTML App")
    .replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 30) || "My HTML App";

  const id = "com.htmlapk." + name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apk-build-"));
  const project = path.join(dir, "project");
  const web = path.join(project, "www");

  try {
    fs.mkdirSync(web, { recursive: true });
    fs.copyFileSync(req.file.path, path.join(web, "index.html"));

    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({
      name: "generated-app",
      version: "1.0.0",
      private: true,
      dependencies: {
        "@capacitor/core": "^7.4.3",
        "@capacitor/android": "^7.4.3"
      },
      devDependencies: {
        "@capacitor/cli": "^7.4.3"
      }
    }));

    fs.writeFileSync(path.join(project, "capacitor.config.json"), JSON.stringify({
      appId: id,
      appName: name,
      webDir: "www"
    }));

    await run("npm", ["install", "--no-audit", "--no-fund"], { cwd: project });
    await run("npx", ["cap", "add", "android"], { cwd: project });
    await run("npx", ["cap", "sync", "android"], { cwd: project });

    await run("./gradlew", ["assembleDebug"], {
      cwd: path.join(project, "android"),
      timeout: 900000
    });

    const apk = path.join(project, "android/app/build/outputs/apk/debug/app-debug.apk");

    if (!fs.existsSync(apk)) throw new Error("APK not found.");

    res.download(apk, name.replace(/ /g, "-") + ".apk", () => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "APK build failed.",
        detail: (error.stderr || error.message || "").slice(-2000)
      });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  } finally {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
  }
});

app.listen(PORT, () => {
  console.log("HTML TO APK MAKER running on port " + PORT);
});
