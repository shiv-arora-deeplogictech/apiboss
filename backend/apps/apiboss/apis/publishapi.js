const { json } = require("stream/consumers");

/**
 * (C) 2020 TekMonks. All rights reserved.
 *
 * Publish new API with aiwall rules
 */
const AIWALLRULES = require(`${APPCONSTANTS.CONF_DIR}/aiwallrules.json`);
const updateconf = require(`${__dirname}/updateconf.js`);
const fs = require("fs").promises;
const fsSync = require("fs");
const APIREGISTRY = require(CONSTANTS.LIBDIR + "/apiregistry.js");

exports.doService = async req => {
    const jsonReq = req.data;

    if (!validateRequest(jsonReq)) {
        LOG.error(`Bad API publish request ${jsonReq ? JSON.stringify(jsonReq) : "null"}.`);
        return { data: CONSTANTS.FALSE_RESULT };
    }

    // Check if this is an update operation (path already exists)
    const isUpdate = AIWALLRULES[jsonReq.path] !== undefined;
    let x_api_key_user = req.data?.x_api_key;
    
    if (isUpdate) {
        // For updates, retrieve the existing API key
        const existingKey = await getExistingApiKey(jsonReq.path);
        if (existingKey) {
            x_api_key_user = existingKey;
            LOG.info(`Update operation detected for ${jsonReq.path}, reusing existing key`);
        } else {
            LOG.warn(`Update operation but no existing key found for ${jsonReq.path}, generating new key`);
            x_api_key_user = x_api_key_user || generateRandomKey();
        }
    } else {
        // For new APIs, use provided key or generate new one
        if (!req.data.x_api_key || req.data.x_api_key === "") {
            x_api_key_user = generateRandomKey();
        }
    }
    
    jsonReq.apikey = [x_api_key_user];

    // Generate dynamic registry entry if not provided
    if (!jsonReq.apiregentry) {
        LOG.info(`Regentry not provided, generating dynamically using updateconf.js`);
        await updateconf.doService({ data: { data: _formatRegEntry(jsonReq) } });

        // Merge headers and include aiwall:true
        const mergedHeaders = { ...(jsonReq.headers || {}), aiwall: "true" };
        const encodedURL = encodeURIComponent(jsonReq.backendurl || "");
        const encodedHeaders = encodeURIComponent(JSON.stringify(mergedHeaders));
        const method = jsonReq.method || "POST";

        jsonReq.apiregentry = `/plugins/aiwall.js?keys=${x_api_key_user}&url=${encodedURL}&method=${method}&headers=${encodedHeaders}`;
    }

    // Save rules (no api key or aiwall flags)
    const rules = jsonReq.rules || "[]";
    AIWALLRULES[jsonReq.path] = { rule: rules };

    await fs.writeFile(
        `${APPCONSTANTS.CONF_DIR}/aiwallrules.json`,
        JSON.stringify(AIWALLRULES, null, 4),
        "utf8"
    );

    // Register the API (will update if already exists)
    await APIREGISTRY.addAPI(jsonReq.path, jsonReq.apiregentry, APPCONSTANTS.APP_NAME);
    LOG.info(`${isUpdate ? 'Updated' : 'New'} API published ${jsonReq.path}:${jsonReq.apiregentry}`);

    const apiURL = `${jsonReq.apiregentry}`;
    return {
        data: {
            result: CONSTANTS.TRUE_RESULT,
            "x-api-key": x_api_key_user,
            "api-url": apiURL,
            "is-update": isUpdate
        }
    };
};

async function getExistingApiKey(path) {
    try {
        // Check ratelimits.json for existing key
        const rateLimitPath = `${APPCONSTANTS.CONF_DIR}/ratelimits.json`;
        if (fsSync.existsSync(rateLimitPath)) {
            const rateLimitData = JSON.parse(fsSync.readFileSync(rateLimitPath, 'utf8'));
            
            // Check apiregistry.json for the path's associated key
            const apiRegistryPath = `${APPCONSTANTS.CONF_DIR}/apiregistry.json`;
            if (fsSync.existsSync(apiRegistryPath)) {
                const apiRegistryData = JSON.parse(fsSync.readFileSync(apiRegistryPath, 'utf8'));
                const registryEntry = apiRegistryData[path];
                
                if (registryEntry) {
                    // Extract key from the registry entry URL parameters
                    const keyMatch = registryEntry.match(/keys=([^&]+)/);
                    if (keyMatch && keyMatch[1]) {
                        const extractedKey = decodeURIComponent(keyMatch[1]);
                        // Verify this key exists in ratelimits
                        if (rateLimitData[extractedKey]) {
                            return extractedKey;
                        }
                    }
                }
            }
        }
    } catch (error) {
        LOG.error(`Error retrieving existing API key for ${path}: ${error.message}`);
    }
    return null;
}

function _formatRegEntry(jsonReq) {
    // Allow user to set custom rate limits, fallback to default values
    const rateLimit = jsonReq.rateLimit || {
        persec: 10,
        permin: 100,
        perhour: 1000,
        perday: 5000,
        permonth: 10000,
        peryear: 50000
    };

    return [
        {
            rateLimit: {
                [jsonReq.apikey]: rateLimit
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
