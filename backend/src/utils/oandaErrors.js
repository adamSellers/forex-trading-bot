const MAX_ERROR_BODY_CHARS = 500;

function normalizeWhitespace(value = "") {
    return String(value).replace(/\s+/g, " ").trim();
}

function stripHtml(value = "") {
    return normalizeWhitespace(String(value).replace(/<[^>]*>/g, " "));
}

function truncate(value = "", maxLength = MAX_ERROR_BODY_CHARS) {
    const normalized = normalizeWhitespace(value);
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength)}...`;
}

function extractJsonError(body = "") {
    try {
        const parsed = JSON.parse(body);
        return (
            parsed.errorMessage ||
            parsed.message ||
            parsed.error ||
            parsed.errorCode ||
            null
        );
    } catch {
        return null;
    }
}

function summarizeOandaErrorBody(body = "", contentType = "") {
    const jsonError = extractJsonError(body);
    if (jsonError) {
        return truncate(jsonError);
    }

    const text = String(body || "");
    const isHtml =
        /html/i.test(contentType) ||
        /<html[\s>]/i.test(text) ||
        /cf-error-details/i.test(text);

    if (isHtml) {
        const title = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
        const cloudflareCode = text.match(/cf-error-(\d+)/i)?.[1];
        const summary = stripHtml(title || text);
        const suffix = cloudflareCode ? `Cloudflare ${cloudflareCode}` : "HTML error response";
        return truncate(`${suffix}${summary ? `: ${summary}` : ""}`);
    }

    return truncate(text || "Unknown OANDA error response");
}

async function buildOandaApiError(response) {
    const body = await response.text();
    const contentType = response.headers?.get?.("content-type") || "";
    const summary = summarizeOandaErrorBody(body, contentType);
    return new Error(`Oanda API Error (${response.status}): ${summary}`);
}

module.exports = {
    buildOandaApiError,
    summarizeOandaErrorBody,
};
