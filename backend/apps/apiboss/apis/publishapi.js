/**
 * (C) 2020 TekMonks. All rights reserved.
 *
 * Publish new API with aiwall rules
 */
const AIWALLRULES = require(`${APPCONSTANTS.CONF_DIR}/aiwallrules.json`);
const updateconf = require(`${__dirname}/updateconf.js`);
const fs = require("fs").promises;
const APIREGISTRY = require(CONSTANTS.LIBDIR + "/apiregistry.js");

exports.doService = async req => {
    const jsonReq = req.data;

    if (!validateRequest(jsonReq)) {
        LOG.error(`Bad API publish request ${jsonReq ? JSON.stringify(jsonReq) : "null"}.`);
        return { data: CONSTANTS.FALSE_RESULT };
    }

    const generatedKey = generateRandomKey();

    // Generate dynamic registry entry if not provided
    if (!jsonReq.apiregentry) {
        LOG.info(`Regentry not provided, generating dynamically using updateconf.js`);
        await updateconf.doService({ data: { data: _formatRegEntry(jsonReq) } });

        // Merge headers and include aiwall:true
        const mergedHeaders = { ...(jsonReq.headers || {}), aiwall: "true" };
        const encodedURL = encodeURIComponent(jsonReq.backendurl || "");
        const encodedHeaders = encodeURIComponent(JSON.stringify(mergedHeaders));
        const method = jsonReq.method || "POST";

        jsonReq.apiregentry = `/plugins/aiwall.js?keys=${generatedKey}&url=${encodedURL}&method=${method}&headers=${encodedHeaders}`;
    }

    // Only save rules (no api key or aiwall flags)
    const rules = jsonReq.rules || "[]";
    AIWALLRULES[jsonReq.path] = { rule: rules };

    await fs.writeFile(
        `${APPCONSTANTS.CONF_DIR}/aiwallrules.json`,
        JSON.stringify(AIWALLRULES, null, 4),
        "utf8"
    );

    // Register the new API
    await APIREGISTRY.addAPI(jsonReq.path, jsonReq.apiregentry, APPCONSTANTS.APP_NAME);
    LOG.info(`New API published ${jsonReq.path}:${jsonReq.apiregentry}`);

    const apiURL = `${jsonReq.apiregentry}`;
    return {
        data: {
            result: CONSTANTS.TRUE_RESULT,
            "x-api-key": generatedKey,
            "api-url": apiURL
        }
    };
};

function _formatRegEntry(jsonReq) {
    // builds minimal structure for updateconf
    return [
        {
            rateLimit: {
                [jsonReq.path]: {
                    persec: 10,
                    permin: 100,
                    perhour: 1000,
                    perday: 5000,
                    permonth: 10000,
                    peryear: 50000
                }
            }
        },
        {
            inputoutput: {
                [jsonReq.path]: {
                    inputdata: "application/json",
                    outputdata: "application/json"
                }
            }
        },
        {
            apiregistrydata: {
                [jsonReq.path]: {
                    backendurl: jsonReq.backendurl || "http://localhost",
                    backendurlmethod: jsonReq.method || "POST",
                    isrestapi: "NO",
                    needsToken: "NO",
                    addsToken: "NO",
                    needsBasicAuth: "NO",
                    apikey: [],
                    customContentType: "",
                    exposedmethod: jsonReq.method || "POST",
                    injected: {},
                    passthrough: ""
                }
            }
        }
    ];
}

const validateRequest = jsonReq => {
    return !!(jsonReq && jsonReq.path && (jsonReq.apiregentry || jsonReq.backendurl));
};

function generateRandomKey() {
    // Generate a UUID v4 format key
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
