import { execFileSync } from "node:child_process";
import process from "node:process";

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
}

function stop(message) {
  console.error(`\nDeployment blocked: ${message}\n`);
  process.exit(1);
}

const peebeeAccountId = "5b3ae942adb5457f1fa4d7f5effbf3ff";
if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ACCOUNT_ID !== peebeeAccountId) {
  stop("CLOUDFLARE_ACCOUNT_ID must identify the Peebee account (peebeeapp@gmail.com).");
}

let root;
try {
  root = git(["rev-parse", "--show-toplevel"]);
} catch {
  stop("this command must run inside the Peebee Git repository.");
}

const branch = git(["branch", "--show-current"], { cwd: root });
if (branch !== "main") {
  stop(`the current branch is '${branch || "detached HEAD"}'. Merge the work into main before deploying.`);
}

const changes = git(["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root });
if (changes) {
  stop("the working tree has uncommitted files. Commit and merge them before deploying.");
}

try {
  execFileSync("git", ["fetch", "--quiet", "origin", "main"], { cwd: root, stdio: "inherit" });
} catch {
  stop("origin/main could not be refreshed. Check the network before deploying.");
}

const local = git(["rev-parse", "HEAD"], { cwd: root });
const remote = git(["rev-parse", "origin/main"], { cwd: root });
if (local !== remote) {
  stop("local main is not the same commit as origin/main. Pull the latest main and resolve any differences first.");
}

console.log(`Deployment source verified: main at ${local.slice(0, 8)}.`);
