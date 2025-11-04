const fs = require("fs").promises;
const path = require("path");
const APIREGISTRY = require(`${CONSTANTS.LIBDIR}/apiregistry.js`);
const RATELIMIT_DISTM_KEY = "__org_monkshu_apiboss_ratelimits";

exports.doService = async req => {
    const jsonReq = req.data || req;

    if (!validateRequest(jsonReq)) {
        LOG.error(`Bad API delete request ${jsonReq ? JSON.stringify(jsonReq) : "null"}.`);
        return { data: { result: false } };
    }

    const apiPath = jsonReq.path;
    const confDir = APPCONSTANTS.CONF_DIR;
    const filesToClean = [
        "apiregistry.json",
        "aiwallrules.json",
        "inputoutput.json",
        "ratelimits.json"
    ];

    try {
        // Load the API registry first to find the key
        const registry = JSON.parse(await fs.readFile(`${confDir}/apiregistry.json`, "utf8"));
        const apiEntry = registry[apiPath];
        let apiKey = null;

        // Extract the key from the URL if present
        if (apiEntry) {
            const match = apiEntry.match(/keys=([^&]+)/);
            if (match) apiKey = match[1];
        }

        await APIREGISTRY.deleteAPI(apiPath, APPCONSTANTS.APP_NAME);

        for (const file of filesToClean) {
            const filePath = path.join(confDir, file);
            try {
                const fileContent = JSON.parse(await fs.readFile(filePath, "utf8"));

                if (file === "ratelimits.json" && apiKey && fileContent[apiKey]) {
                    delete fileContent[apiKey];
                    await fs.writeFile(filePath, JSON.stringify(fileContent, null, 4), "utf8");
                    LOG.info(`Removed API key ${apiKey} from ratelimit.json`);
                } else if (fileContent[apiPath]) {
                    delete fileContent[apiPath];
                    await fs.writeFile(filePath, JSON.stringify(fileContent, null, 4), "utf8");
                    LOG.info(`Removed ${apiPath} from ${file}`);
                }
            } catch (err) {
                LOG.warn(`Skipped ${file}: ${err.message}`);
            }
        }

        LOG.info(`Deleted API and related entries for ${apiPath}`);
        return { data: { result: true } };

    } catch (err) {
        LOG.error(`Failed to delete API ${apiPath}: ${err.message}`);
        return { data: { result: false, error: err.message } };
    }
};

const validateRequest = jsonReq => jsonReq && jsonReq.path;