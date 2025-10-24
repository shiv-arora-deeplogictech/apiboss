/** 
 * (C) 2020 TekMonks. All rights reserved.
 * 
 * Proxy for JSON/REST APIs for APIBoss
 */
const crypto = require("crypto");
const Mustache = require('mustache');
const rest = require(`${CONSTANTS.LIBDIR}/rest.js`);
const { doCall } = require(`${APPCONSTANTS.LIB_DIR}/llmcall.js`);

const apibosslog = require(`${APPCONSTANTS.LIB_DIR}/apibosslog.js`);
const aiwallRules = require(`${APPCONSTANTS.CONF_DIR}/aiwallrules.json`);

exports.doService = doService;

async function doService(req) {


    let method = req.method.toLowerCase(); const url = new URL(req.url); const host = url.hostname;
    const port = url.port; const path = url.pathname + url.search; if (!path.startsWith("/")) path = `/${path}`;
    const headers = { ...req.headers }; const reqObj = req.data;

    if (headers?.aiwall && headers?.aiwall === "true") {
        const route = req?.servObject?.req?.url || path;
        const ruleEntry = aiwallRules[route];
        if (!ruleEntry || !ruleEntry.rule) {
            LOG.warn(`AI Wall: no rule for route ${route}, deny`);
            throw { status: 403, message: "Forbidden: Policy not found" };
        }

        // Deterministic policy checks (examples)
        if (!["POST"].includes(method.toUpperCase())) {
            throw { status: 405, message: "Method Not Allowed" };
        }
        try {

            // Construct validation prompt
            const validationPrompt = `Analyze the following API request and determine if it should be allowed. Return ONLY a valid JSON object with a single boolean field "allowed" (true or false). Do not include any explanations, markdown formatting, or additional text.

User Query:
{{{userQuery}}}

API Security Rules:
{{{aiwallRules}}}

Instructions:
1. Check if the request violates any of the security rules above.
2. Consider the request method, path, headers, and body content.
3. Return <out>true</out> **only if the request fully complies with all rules.**
4. Return <out>false</out> if the request violates any security rule in any way.
5. Do not include any extra text or formatting outside of the JSON object.

Response format (strict): {"allowed": true} or {"allowed": false}`;

            // The user query is extracted from the request body (Currently set according to Gemini chat format)
            const messages = req?.data?.messages || [];
            const userQuery = messages[messages.length - 1]?.content || "";

            const endpointCalled = req?.servObject?.req?.url || '';
            const renderedPrompt = Mustache.render(validationPrompt, { aiwallRules: aiwallRules[endpointCalled].rule, userQuery: userQuery });

            // Make LLM call
            const llmResponse = await doCall(renderedPrompt);

            // Parse and validate LLM response
            let validationResult;
            try {
                // Clean response content (remove markdown code blocks if present)
                let cleanContent = llmResponse.content.trim();
                if (cleanContent.startsWith('```')) {
                    cleanContent = cleanContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                }

                validationResult = JSON.parse(cleanContent);

                if (typeof validationResult.allowed !== 'boolean') {
                    throw new Error('Invalid validation result: "allowed" field must be a boolean');
                }
            } catch (parseError) {
                LOG.error(`Failed to parse LLM validation response: ${parseError.message}, Response: ${llmResponse.content}`);
                throw new Error('AI Wall validation failed: invalid response format');
            }

            // Block request if not allowed
            if (!validationResult.allowed) {
                const blockMessage = `AI Wall blocked request: ${method.toUpperCase()} ${host}${path}`;
                LOG.error(blockMessage);
                throw { status: 401, message: "Unauthorized: Request blocked by AI Wall" };
            }

            LOG.info(`AI Wall allowed request: ${method.toUpperCase()} ${host}${path}`);

        } catch (error) {
            // If error already has status (from validation block), re-throw as is
            if (error.status) {
                throw error;
            }

            // Otherwise, log and throw unauthorized error
            LOG.error(`AI Wall validation error: ${error.message || error}`);
            throw { status: 401, message: "Unauthorized: AI Wall validation failed" };
        }
    }

    if (url.protocol.toLowerCase() == "https:") method += "Https";
    if (method == "delete") method = "deleteHttp";        // delete is a reserved word in JS

    const timestamp = Date.now(), id = `${timestamp}${parseInt(crypto.randomBytes(4).toString("hex"), 16)}`;
    apibosslog.recordRequest(id, timestamp, method, host, port, path, headers, reqObj, "rest"); // log request, async, don't wait
    const { error, data, status, resHeaders } = await rest[method](host, port, path, headers, reqObj);
    apibosslog.recordResponse(id, Date.now(), error, data, status, resHeaders, "rest"); // log response, async, don't wait

    if (error) throw ("APIBoss REST Proxy Error", { status, message: error });
    else return ({ data, headers: resHeaders });
}



function extractBetweenTags(text, tag="out") {
  const startTag = `<${tag}>`, endTag = `</${tag}>`;
  const s = text.indexOf(startTag), e = text.indexOf(endTag, s + startTag.length);
  if (s !== -1 && e !== -1) return text.slice(s + startTag.length, e).trim();
  return null;
}
function extractJSONWithFallback(text) {
  const tagged = extractBetweenTags(text) || extractBetweenTags(text, "output");
  if (tagged) return extractFirstJSONObject(tagged);
  return extractFirstJSONObject(text);
}