// Upload an existing Firefox XPI to AMO's unlisted-signing endpoint.
//
// This intentionally does not use web-ext: the repository already produces
// the final XPI, and Node 20+ provides the HTTP, FormData, and File APIs we
// need.
//
// Usage:
//   AMO_API_KEY=... AMO_API_SECRET=... npm run sign:firefox
//   AMO_API_KEY=... AMO_API_SECRET=... node scripts/sign-firefox.mjs \
//     --input /path/to/addon.xpi --output /path/to/addon-signed.xpi

import { createHash, createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultInput = path.join(root, "dist", "chrome-history-tab-manager-firefox.xpi");
const defaultAmoBaseUrl = "https://addons.mozilla.org/api/v5/";
const channel = "unlisted";
const validationCheckIntervalMs = 1000;
const validationCheckTimeoutMs = 5 * 60 * 1000;
const approvalCheckIntervalMs = 1000;
const approvalCheckTimeoutMs = 15 * 60 * 1000;

function printHelp() {
  console.log(`
Sign an existing Firefox XPI through AMO self-distribution.

Required environment variables:
  AMO_API_KEY       API issuer from the AMO API credentials page
  AMO_API_SECRET    API secret from the AMO API credentials page

Usage:
  npm run pack:firefox
  AMO_API_KEY=... AMO_API_SECRET=... npm run sign:firefox

Options:
  --input <path>      Unsigned XPI (default: dist/chrome-history-tab-manager-firefox.xpi)
  --output <path>     Signed XPI (default: dist/chrome-history-tab-manager-firefox-v<version>-signed.xpi)
  --id <id>           Firefox add-on ID when manifest.json has no gecko.id
  --amo-base-url <url>
                      AMO API base URL (default: ${defaultAmoBaseUrl})
  --help
`);
}

function parseArgs(argv) {
  const options = {
    input: defaultInput,
    output: undefined,
    id: undefined,
    amoBaseUrl: defaultAmoBaseUrl
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }

    const value = argv[index + 1];
    if (argument === "--input") {
      options.input = value;
      index += 1;
    } else if (argument === "--output") {
      options.output = value;
      index += 1;
    } else if (argument === "--id") {
      options.id = value;
      index += 1;
    } else if (argument === "--amo-base-url") {
      options.amoBaseUrl = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function requireOptionValue(option, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function base64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function createJwt(apiKey, apiSecret) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256" }));
  const payload = base64Url(
    JSON.stringify({
      iss: apiKey,
      iat: issuedAt,
      exp: issuedAt + 5 * 60
    })
  );
  const signature = createHmac("sha256", apiSecret)
    .update(`${header}.${payload}`)
    .digest();

  return `${header}.${payload}.${base64Url(signature)}`;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url;
}

function makeUrl(baseUrl, relativePath) {
  return new URL(relativePath, baseUrl);
}

function defaultOutputPath(version) {
  const versionTag = String(version ?? "unknown")
    .trim()
    .replace(/[^0-9A-Za-z._-]+/gu, "_") || "unknown";
  return path.join(
    root,
    "dist",
    `chrome-history-tab-manager-firefox-v${versionTag}-signed.xpi`
  );
}

function formatResponseBody(body, fallbackText = "") {
  if (body === undefined || body === null) {
    return fallbackText;
  }
  if (typeof body === "string") {
    return body;
  }
  return JSON.stringify(body, null, 2);
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return { body: undefined, text };
  }

  try {
    return { body: JSON.parse(text), text };
  } catch {
    return { body: text, text };
  }
}

async function amoRequest({
  baseUrl,
  apiKey,
  apiSecret,
  relativePath,
  method = "GET",
  body
}) {
  const headers = {
    Authorization: `JWT ${createJwt(apiKey, apiSecret)}`,
    Accept: "application/json",
    "User-Agent": "chrome-history-tab-manager-sign-script"
  };

  if (typeof body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(makeUrl(baseUrl, relativePath), {
    method,
    headers,
    body
  });
  const { body: responseBody, text } = await readJsonResponse(response);

  if (!response.ok) {
    const details = formatResponseBody(responseBody, text);
    throw new Error(
      `${method} ${relativePath} failed with ${response.status} ${response.statusText}:\n${details}`
    );
  }

  return responseBody;
}

async function readManifestFromXpi(inputPath) {
  const { stdout } = await execFileAsync("unzip", ["-p", inputPath, "manifest.json"]);

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Could not parse manifest.json from ${inputPath}: ${error.message}`);
  }
}

function getFirefoxId(manifest, explicitId) {
  const manifestId = manifest.browser_specific_settings?.gecko?.id;
  if (manifestId && explicitId && manifestId !== explicitId) {
    throw new Error(
      `The --id value (${explicitId}) does not match manifest.json gecko.id (${manifestId}).`
    );
  }

  const addonId = explicitId ?? manifestId;
  if (!addonId) {
    throw new Error(
      "No Firefox add-on ID found. Add browser_specific_settings.gecko.id to the Firefox manifest or pass --id."
    );
  }

  return addonId;
}

function summarizeValidation(validation) {
  const messages = validation?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }

  return messages
    .slice(0, 12)
    .map((message) => {
      const location = [message.file, message.line, message.column]
        .filter((part) => part !== undefined && part !== null)
        .join(":");
      return `- ${location ? `${location}: ` : ""}${message.message ?? JSON.stringify(message)}`;
    })
    .join("\n");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function loadCachedUpload(cachePath, inputHash) {
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    if (cache.channel === channel && cache.xpiSha256 === inputHash && cache.uploadUuid) {
      return cache.uploadUuid;
    }
  } catch {
    // A missing or malformed cache simply causes a fresh upload.
  }
  return undefined;
}

async function saveCachedUpload(cachePath, inputHash, uploadUuid) {
  await writeFile(
    cachePath,
    `${JSON.stringify(
      {
        channel,
        xpiSha256: inputHash,
        uploadUuid
      },
      null,
      2
    )}\n`
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForValidation({ baseUrl, apiKey, apiSecret, uploadUuid }) {
  const deadline = Date.now() + validationCheckTimeoutMs;
  let lastNotice;

  while (Date.now() < deadline) {
    const result = await amoRequest({
      baseUrl,
      apiKey,
      apiSecret,
      relativePath: `addons/upload/${encodeURIComponent(uploadUuid)}/`
    });

    if (result.processed) {
      if (!result.valid) {
        const details = summarizeValidation(result.validation_results);
        throw new Error(
          `AMO rejected the XPI during validation.${details ? `\n${details}` : ""}\n\nFull validation result:\n${formatResponseBody(result.validation_results)}`
        );
      }
      return result.uuid ?? uploadUuid;
    }

    const notice =
      result.validation_results?.message ?? "AMO is still validating the upload";
    if (notice !== lastNotice) {
      console.log(`  ${notice}...`);
      lastNotice = notice;
    }
    await sleep(validationCheckIntervalMs);
  }

  throw new Error(`AMO validation timed out after ${validationCheckTimeoutMs / 1000} seconds.`);
}

async function uploadXpi({ baseUrl, apiKey, apiSecret, inputPath, inputBuffer, cachePath }) {
  const inputHash = sha256(inputBuffer);
  const cachedUploadUuid = await loadCachedUpload(cachePath, inputHash);
  if (cachedUploadUuid) {
    try {
      console.log(`Reusing cached AMO upload ${cachedUploadUuid}.`);
      return await waitForValidation({
        baseUrl,
        apiKey,
        apiSecret,
        uploadUuid: cachedUploadUuid
      });
    } catch (error) {
      console.log("Cached upload is no longer usable; uploading a fresh copy.");
      console.log(`  ${error.message.split("\n", 1)[0]}`);
    }
  }

  const formData = new FormData();
  formData.set("channel", channel);
  formData.set(
    "upload",
    new File([inputBuffer], path.basename(inputPath), {
      type: "application/x-xpinstall"
    })
  );

  console.log(`Uploading ${path.basename(inputPath)} to AMO (${channel})...`);
  const result = await amoRequest({
    baseUrl,
    apiKey,
    apiSecret,
    relativePath: "addons/upload/",
    method: "POST",
    body: formData
  });

  if (!result.uuid) {
    throw new Error(`AMO upload did not return a UUID:\n${formatResponseBody(result)}`);
  }

  await saveCachedUpload(cachePath, inputHash, result.uuid);
  console.log(`AMO upload accepted: ${result.uuid}`);

  return waitForValidation({
    baseUrl,
    apiKey,
    apiSecret,
    uploadUuid: result.uuid
  });
}

async function submitAddon({ baseUrl, apiKey, apiSecret, addonId, uploadUuid }) {
  const relativePath = `addons/addon/${encodeURIComponent(addonId)}/`;

  console.log(`Submitting a new AMO version for ${addonId}...`);
  return amoRequest({
    baseUrl,
    apiKey,
    apiSecret,
    relativePath,
    method: "PUT",
    body: JSON.stringify({
      version: {
        upload: uploadUuid
      }
    })
  });
}

async function waitForApproval({ baseUrl, apiKey, apiSecret, addonId, versionId }) {
  const deadline = Date.now() + approvalCheckTimeoutMs;
  let lastNotice;

  while (Date.now() < deadline) {
    const result = await amoRequest({
      baseUrl,
      apiKey,
      apiSecret,
      relativePath: `addons/addon/${encodeURIComponent(addonId)}/versions/${encodeURIComponent(versionId)}/`
    });

    if (result.file?.status === "public" && result.file.url) {
      return result.file.url;
    }

    const notice = result.file?.status ?? "waiting for AMO to sign the version";
    if (notice !== lastNotice) {
      console.log(`  AMO version status: ${notice}`);
      lastNotice = notice;
    }
    await sleep(approvalCheckIntervalMs);
  }

  throw new Error(
    `AMO approval timed out after ${approvalCheckTimeoutMs / 1000} seconds.`
  );
}

async function downloadSignedXpi({
  baseUrl,
  apiKey,
  apiSecret,
  fileUrl,
  outputPath
}) {
  const response = await fetch(new URL(fileUrl, baseUrl), {
    headers: {
      Authorization: `JWT ${createJwt(apiKey, apiSecret)}`,
      "User-Agent": "chrome-history-tab-manager-sign-script"
    }
  });

  if (!response.ok) {
    const { body, text } = await readJsonResponse(response);
    throw new Error(
      `Downloading the signed XPI failed with ${response.status} ${response.statusText}:\n${formatResponseBody(body, text)}`
    );
  }

  const signedBuffer = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, signedBuffer);
  return signedBuffer.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  options.input = path.resolve(root, requireOptionValue("--input", options.input));

  const apiKey = process.env.AMO_API_KEY ?? process.env.WEB_EXT_API_KEY;
  const apiSecret = process.env.AMO_API_SECRET ?? process.env.WEB_EXT_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error(
      "Missing AMO credentials. Set AMO_API_KEY and AMO_API_SECRET, or WEB_EXT_API_KEY and WEB_EXT_API_SECRET."
    );
  }

  const baseUrl = normalizeBaseUrl(options.amoBaseUrl);
  const inputBuffer = await readFile(options.input);
  const manifest = await readManifestFromXpi(options.input);
  const addonId = getFirefoxId(manifest, options.id);
  const outputPath = options.output
    ? path.resolve(root, requireOptionValue("--output", options.output))
    : defaultOutputPath(manifest.version);
  const cachePath = path.join(path.dirname(options.input), ".amo-upload.json");

  console.log(`Extension: ${manifest.name ?? "(unnamed)"}`);
  console.log(`Version: ${manifest.version ?? "(unknown)"}`);
  console.log(`Firefox ID: ${addonId}`);
  console.log(`Input: ${options.input}`);

  const uploadUuid = await uploadXpi({
    baseUrl,
    apiKey,
    apiSecret,
    inputPath: options.input,
    inputBuffer,
    cachePath
  });
  console.log("AMO validation passed.");

  const submission = await submitAddon({
    baseUrl,
    apiKey,
    apiSecret,
    addonId,
    uploadUuid
  });
  const submittedAddonId = submission.guid ?? submission.id ?? addonId;
  const versionId = submission.version?.id;
  if (!submittedAddonId || versionId === undefined || versionId === null) {
    throw new Error(
      `AMO submission did not return an add-on ID and version ID:\n${formatResponseBody(submission)}`
    );
  }

  const fileUrl = await waitForApproval({
    baseUrl,
    apiKey,
    apiSecret,
    addonId: submittedAddonId,
    versionId
  });
  const signedSize = await downloadSignedXpi({
    baseUrl,
    apiKey,
    apiSecret,
    fileUrl,
    outputPath
  });

  console.log(`Signed XPI saved: ${outputPath} (${signedSize} bytes)`);
}

main().catch((error) => {
  console.error(`sign-firefox failed: ${error.message}`);
  process.exitCode = 1;
});
