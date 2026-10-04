import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = path.resolve(
  process.argv[2] || path.join(adminRoot, "..", "Smart Store Hub", "services", "core", ".env"),
);
const targetFile = path.join(adminRoot, ".env");

function parseEnv(contents) {
  const result = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

function replaceValue(contents, name, value) {
  const entry = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  return pattern.test(contents)
    ? contents.replace(pattern, entry)
    : `${contents.trimEnd()}\n${entry}\n`;
}

const [sourceContents, targetContents] = await Promise.all([
  readFile(sourceFile, "utf8"),
  readFile(targetFile, "utf8"),
]);
const source = parseEnv(sourceContents);
const target = parseEnv(targetContents);
const key =
  source.SUPABASE_SERVICE_ROLE_KEY ||
  source.SUPABASE_SECRET_KEY ||
  source.SUPABASE_KEY;
const supabaseUrl = target.SUPABASE_URL || source.SUPABASE_URL;

if (!key) throw new Error("Nenhuma chave Supabase foi encontrada no arquivo de origem.");
if (!supabaseUrl) throw new Error("SUPABASE_URL nao foi encontrada.");

const response = await fetch(`${supabaseUrl}/rest/v1/`, {
  headers: { apikey: key },
});
if (!response.ok) {
  throw new Error(`A chave de origem nao foi aceita como chave secreta (HTTP ${response.status}).`);
}

const temporaryFile = `${targetFile}.tmp`;
await writeFile(
  temporaryFile,
  replaceValue(targetContents, "SUPABASE_SERVICE_ROLE_KEY", key),
  { mode: 0o600 },
);
await rename(temporaryFile, targetFile);
await chmod(targetFile, 0o600);
console.log("Chave secreta sincronizada com seguranca; nenhum valor foi exibido.");
const mode = (await stat(targetFile)).mode & 0o777;
if (mode & 0o077) {
  console.warn(
    "Aviso: este sistema de arquivos nao aplica permissoes Unix restritas. " +
      "O arquivo esta fora do Git, mas deve permanecer em uma maquina confiavel.",
  );
}
