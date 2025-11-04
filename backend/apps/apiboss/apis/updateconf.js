/**
 * (C) 2020 TekMonks. All rights reserved.
 *
 * Update configuration and register APIs
 */
const cryptmod = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const fs = require("fs");
const publish = require(`${__dirname}/publish.js`);
const RATELIMIT_DISTM_KEY = "__org_monkshu_apiboss_ratelimits";
const HTTPAUTH_DISTM_KEY = "__org_monkshu_apiboss_httpauths";
const API_REG_DISTM_KEY = "__org_monkshu_apiregistry_key";
const apiregistry = require(`${CONSTANTS.LIBDIR}/apiregistry.js`);

exports.doService = async jsonReq => {
    if (!validateRequest(jsonReq)) {
        LOG.error(`Bad API list request ${jsonReq ? JSON.stringify(jsonReq) : "null"}.`);
        return { data: CONSTANTS.FALSE_RESULT };
    } 
    
    if (jsonReq.data?.data?.operation === "delete") {
        const deleteModule = require(`${__dirname}/delete.js`);
        const deletePath = jsonReq.data.data.path;
        LOG.info(`Delete operation triggered for ${deletePath}`);
        return await deleteModule.doService({ data: { path: deletePath } });
    }

    else {
        _generateRateLimit(jsonReq);
        _generateHttpBasicAuth(jsonReq);
        _generateInputOutput(jsonReq);
        await _generateApiRegistry(jsonReq);
        return { data: { result: true } };
    }
};

async function updateCluster(apiregkey, key, value, regFile) {
    const apireg = CLUSTER_MEMORY.get(apiregkey);
    apireg[key] = value;
    CLUSTER_MEMORY.set(apiregkey, apireg);
    const regFileObj = JSON.parse(fs.readFileSync(regFile));
    regFileObj[key] = value;
    fs.writeFileSync(regFile, JSON.stringify(regFileObj, null, 4));
}

function _generateRateLimit(jsonReq) {
    if (!fs.existsSync(`${APPCONSTANTS.CONF_DIR}/ratelimits.json`)) {
        fs.writeFileSync(`${APPCONSTANTS.CONF_DIR}/ratelimits.json`, JSON.stringify({}));
    }
    _writeFile(jsonReq.data.data);
}

function _generateHttpBasicAuth(jsonReq) {
    if (!fs.existsSync(`${APPCONSTANTS.CONF_DIR}/httpbasicauths.json`)) {
        fs.writeFileSync(`${APPCONSTANTS.CONF_DIR}/httpbasicauths.json`, JSON.stringify({}));
    }
    _writeHttpBasiAuth(jsonReq.data.data);
}

function _generateInputOutput(jsonReq) {
    if (!fs.existsSync(`${APPCONSTANTS.CONF_DIR}/inputoutput.json`)) {
        fs.writeFileSync(`${APPCONSTANTS.CONF_DIR}/inputoutput.json`, JSON.stringify({}));
    }
    _writeInputOutput(jsonReq.data.data);
}

async function _generateApiRegistry(jsonReq) {
    if (!fs.existsSync(`${APPCONSTANTS.CONF_DIR}/apiregistry.json`)) {
        fs.writeFileSync(`${APPCONSTANTS.CONF_DIR}/apiregistry.json`, JSON.stringify({}));
    }
    await _writeApiRegistry(jsonReq.data.data);
}

async function _writeFile(req) {
    let file = fs.readFileSync(`${APPCONSTANTS.CONF_DIR}/ratelimits.json`);
    let data = JSON.parse(file);
    for (let key in req[0].rateLimit) {
        data[key] = {
            callsPerSecond: parseInt(req[0].rateLimit[key].persec) || "",
            callsPerMinute: parseInt(req[0].rateLimit[key].permin) || "",
            callsPerHour: parseInt(req[0].rateLimit[key].perhour) || "",
            callsPerDay: parseInt(req[0].rateLimit[key].perday) || "",
            callsPerMonth: parseInt(req[0].rateLimit[key].permonth) || "",
            callsPerYear: parseInt(req[0].rateLimit[key].peryear) || ""
        };
        await updateCluster(
            RATELIMIT_DISTM_KEY,
            key,
            data[key],
            `${APPCONSTANTS.CONF_DIR}/ratelimits.json`
        );
    }
}

async function _writeHttpBasiAuth(req) {
    let file = fs.readFileSync(`${APPCONSTANTS.CONF_DIR}/httpbasicauths.json`);
    let data = JSON.parse(file);
    for (let key in req[0].rateLimit) {
        if (req[0].rateLimit[key].userid && req[0].rateLimit[key].password) {
            let base64Str = Buffer.from(
                `${req[0].rateLimit[key].userid}:${req[0].rateLimit[key].password}`
            ).toString("base64");
            data[key] = `${cryptmod.encrypt(base64Str)}`;
            await updateCluster(
                HTTPAUTH_DISTM_KEY,
                key,
                data[key],
                `${APPCONSTANTS.CONF_DIR}/httpbasicauths.json`
            );
        }
    }
}

function _writeInputOutput(req) {
    let file = fs.readFileSync(`${APPCONSTANTS.CONF_DIR}/inputoutput.json`);
    let data = JSON.parse(file);
    for (let key in req[1].inputoutput) {
        data[key] = {
            inputdata: req[1].inputoutput[key].inputdata,
            outputdata: req[1].inputoutput[key].outputdata
        };
    }
    fs.writeFileSync(`${APPCONSTANTS.CONF_DIR}/inputoutput.json`, JSON.stringify(data, null, 4));
}

async function _writeApiRegistry(req) {
    let file = fs.readFileSync(`${APPCONSTANTS.CONF_DIR}/apiregistry.json`);
    let data = JSON.parse(file);

    for (let key in req[2].apiregistrydata) {
        let value = "?";
        const item = req[2].apiregistrydata[key];

        if (item.isrestapi !== "YES") value += `&notRESTAPI=true`;
        if (item.needsToken == "YES") value += `&needsToken=${item.jwtsubject}`;
        if (item.needsBasicAuth !== "NO") value += `&needsBasicAuth=true`;
        if (item.addsToken !== "NO") value += `&addsToken=sub:${item.tokensubject}`;
        if (item.apikey.length) value += `&keys=${item.apikey}`;
        if (item.customContentType.length) value += `&customContentType=${item.customContentType}`;
        if (item.exposedmethod.toLowerCase() == "get") value += `&get=true`;

        value += `&url=${encodeURIComponent(`${item.backendurl}`)}`;
        value += `&method=${item.backendurlmethod}`;

        // Always add headers and include aiwall:true
        value += `&headers=`;
        let headerObj = { aiwall: "true" };

        // Merge injected and headers if available
        if (item.injected && typeof item.injected === "object")
            Object.assign(headerObj, item.injected);
        if (item.headers && typeof item.headers === "object")
            Object.assign(headerObj, item.headers);

        if (item.passthrough)
            headerObj["x-apiboss-passthru-headers"] = item.passthrough.split(",");

        value += `${encodeURIComponent(JSON.stringify(headerObj))}`;

        // Choose plugin or restproxy
        const target =
            item.isrestapi !== "YES"
                ? `/plugins/aiwall.js?${value.slice(2)}`
                : `/apis/restproxy.js?${value.slice(2)}`;

        const rateLimitConfig = req[0]?.rateLimit?.[key] || {};
        await publish.doService({
            data: { path: `${key}`, backendurl: item.backendurl, method: item.backendurlmethod, apiregentry: target, rateLimit: rateLimitConfig }
        });
    }
}

const validateRequest = jsonReq => jsonReq ? true : false;
