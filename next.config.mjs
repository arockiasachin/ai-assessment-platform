import { realpathSync } from "node:fs"
import { dirname, resolve } from "node:path"

/**
 * Turbopack resolves files only under `turbopack.root`. This repo's CI and
 * local workflows use `git worktree`, where `node_modules` is a symlink to the
 * main install; a symlink that points outside the worktree root makes Turbopack
 * abort with "Symlink [project]/node_modules is invalid, it points out of the
 * filesystem root".
 *
 * Resolving the real `node_modules` location and using its parent as the root
 * keeps builds working in both the main checkout (root == repo root, the
 * default) and worktrees, without hardcoding a machine-specific path.
 */
function turbopackRoot() {
  try {
    return dirname(realpathSync(resolve(process.cwd(), "node_modules")))
  } catch {
    return process.cwd()
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // `pdf-parse` (used by the submission upload route, `lib/attachment-upload.ts`)
  // loads `pdfjs-dist`'s worker by module *path* at runtime. A bundled server
  // build rewrites that path into `.next/…/chunks`, where the worker file does
  // not exist, so extraction fails with "Setting up fake worker failed".
  // Keeping the package external makes Node require it from `node_modules`,
  // where the worker sits beside the library.
  serverExternalPackages: ["pdf-parse"],
  turbopack: {
    root: turbopackRoot(),
  },
}

export default nextConfig
