import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { readFileSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const cssPath = resolve(__dirname, '..', 'styles', 'design-tokens.css')
const cssContent = readFileSync(cssPath, 'utf-8')
const variables: Record<string, string> = {}
const regex = /(--[\w-]+):\s*([^;]+);/g
let match

while ((match = regex.exec(cssContent)) !== null) {
  variables[match[1].trim()] = match[2].trim()
}

const root = document.documentElement.style
for (const [name, value] of Object.entries(variables)) {
  root.setProperty(name, value)
}
