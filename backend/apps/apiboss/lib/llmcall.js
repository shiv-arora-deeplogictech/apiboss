/**
 * Makes an LLM API call with the given prompt
 * @param {string} prompt - The user prompt to send to the LLM
 * @returns {Promise<Object>} - The LLM response message object
 * @throws {Error} - If the LLM call fails
 */

const fetch = require('node-fetch');
const llmConf = require(`${APPCONSTANTS.CONF_DIR}/llm.json`);

async function doCall(prompt) {
    try {
        // Validate prompt
        if (!prompt || typeof prompt !== 'string') {
            throw new Error('Invalid prompt: must be a non-empty string');
        }

        // Destructure and validate LLM configuration
        let { protocol, systemPrompt, host, port, path, model, method, headers, additionalParams } = llmConf;

        if (!protocol || !host || !path || !model) {
            throw new Error('Invalid LLM configuration: missing required fields');
        }

        // Build request payload
        const reqObj = {
            model,
            messages: [
                { role: "system", content: systemPrompt || "You are a helpful assistant." },
                { role: "user", content: prompt }
            ],
            ...(additionalParams || {})
        };

        // Build full URL
        const url = `${protocol}://${host}${port ? `:${port}` : ''}${path}`;

        // Prepare fetch options
        const fetchOptions = {
            method: method.toUpperCase(),
            headers: {
                'Content-Type': 'application/json',
                ...(headers || {})
            },
            body: JSON.stringify(reqObj)
        };

        // Make the fetch request
        const response = await fetch(url, fetchOptions);

        // Parse response
        const data = await response.json();

        // Handle HTTP errors
        if (!response.ok) {
            throw new Error(`LLM API returned HTTP ${response.status}: ${JSON.stringify(data)}`);
        }

        // Validate response structure
        if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Invalid LLM response structure');
        }

        const llmResponse = data.choices[0].message;

        // Validate message content
        if (!llmResponse.content) {
            throw new Error('LLM response missing content');
        }

        return llmResponse;

    } catch (error) {
        // Enhanced error logging
        const errorDetails = {
            message: error.message,
            prompt: prompt?.substring(0, 100) // Log first 100 chars of prompt
        };

        LOG.error(`LLM API call failed: ${JSON.stringify(errorDetails)}`);

        // Re-throw with more context
        throw new Error(`LLM API call failed: ${error.message}`);
    }
}
module.exports = {doCall};
