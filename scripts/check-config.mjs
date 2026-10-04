import { readFile } from "node:fs/promises";

function parseEnv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

const env = parseEnv(await readFile(new URL("../.env", import.meta.url), "utf8"));
const required = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "ADMIN_SITE_URL"];
const missing = required.filter((name) => !env[name]);

if (missing.length) {
  console.error(`Configuracao ausente: ${missing.join(", ")}`);
  process.exit(1);
}

for (const name of ["SUPABASE_URL", "ADMIN_SITE_URL"]) {
  try {
    new URL(env[name]);
  } catch {
    console.error(`${name} nao e uma URL valida.`);
    process.exit(1);
  }
}

let response;
try {
  response = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
    },
  });
} catch (error) {
  console.error(`Nao foi possivel acessar o Supabase: ${error.cause?.message || error.message}`);
  process.exit(1);
}

if (!response.ok) {
  console.error(`Supabase respondeu HTTP ${response.status}: ${await response.text()}`);
  process.exit(1);
}

console.log("Configuracao publica valida e Supabase acessivel.");
const authSettings = await response.json();
console.log(
  authSettings.external?.google
    ? "Provedor Google habilitado no Supabase."
    : "Provedor Google ainda nao esta habilitado no Supabase.",
);
console.log(
  env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
    ? "Credenciais OAuth locais preenchidas."
    : "Credenciais OAuth ainda nao preenchidas no .env.",
);

if (env.SUPABASE_SERVICE_ROLE_KEY) {
  let serviceResponse;
  try {
    serviceResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    });
  } catch (error) {
    console.error(`Nao foi possivel testar a chave service role: ${error.cause?.message || error.message}`);
    process.exit(1);
  }

  if (!serviceResponse.ok) {
    console.error(`A chave service role foi recusada (HTTP ${serviceResponse.status}).`);
    process.exit(1);
  }
  console.log("Chave service role preenchida e aceita pelo Supabase.");
} else {
  console.log("Chave service role nao preenchida no .env (opcional). ");
}
