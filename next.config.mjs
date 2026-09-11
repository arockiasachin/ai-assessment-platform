import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

/**
 * This repository is sometimes worked on in a git worktree whose `node_modules`
 * is a symlink to the main checkout (a disk-saving setup for parallel pods).
 * Turbopack auto-detects the project root from `package-lock.json` and refuses
 * any symlink that points outside it ("points out of the filesystem root"), so
 * the production build panics before compiling anything.
 *
 * When (and only when) `node_modules` is such a symlink, widen the Turbopack
 * root to the closest directory that contains both the project and the linked
 * dependencies. A normal checkout with a real `node_modules` leaves the option
 * unset, so CI and local builds behave exactly as before.
 */
function linkedNodeModulesTarget() {
  const nodeModulesPath = path.join(projectRoot, "node_modules")
  try {
    if (!fs.lstatSync(nodeModulesPath).isSymbolicLink()) return null
    return fs.realpathSync(nodeModulesPath)
  } catch {
    return null
  }
}

function commonAncestor(a, b) {
  const aParts = a.split(path.sep)
  const bParts = b.split(path.sep)
  const shared = []
  for (let index = 0; index < Math.min(aParts.length, bParts.length); index += 1) {
    if (aParts[index] !== bParts[index]) break
    shared.push(aParts[index])
  }
  return shared.join(path.sep) || path.sep
}

const linkedTarget = linkedNodeModulesTarget()
const turbopackRoot = linkedTarget ? commonAncestor(projectRoot, linkedTarget) : null

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  ...(turbopackRoot && turbopackRoot !== projectRoot ? { turbopack: { root: turbopackRoot } } : {}),
}

export default nextConfig
