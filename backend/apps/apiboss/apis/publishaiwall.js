/**
 * (C) 2020 TekMonks. All rights reserved.
 *
 * Publish new API with aiwall rules
 */
const AIWALLRULES = require(`${APPCONSTANTS.CONF_DIR}/aiwallrules.json`);
const fs = require("fs").promises;

 exports.doService = async req => {
    const jsonReq = req.data;
	if (!validateRequest(jsonReq)) {LOG.error(`Bad API publish request ${jsonReq?JSON.stringify(jsonReq):"null"}.`); return {data:CONSTANTS.FALSE_RESULT};}
    else {
        const rules = jsonReq.rules || "[]";
        if(!AIWALLRULES[jsonReq.path]) AIWALLRULES[jsonReq.path] = {rule: rules};
        else AIWALLRULES[jsonReq.path].rule = rules; 
        await fs.writeFile(`${APPCONSTANTS.CONF_DIR}/aiwallrules.json`, JSON.stringify(AIWALLRULES, null, 4), "utf8");
        await APIREGISTRY.addAPI(jsonReq.path, jsonReq.apiregentry, APPCONSTANTS.APP_NAME); 
        LOG.info(`New API published ${jsonReq.path}:${jsonReq.apiregentry}`); return {data:CONSTANTS.TRUE_RESULT};
    }
}

const validateRequest = jsonReq => jsonReq && jsonReq.path && jsonReq.apiregentry;