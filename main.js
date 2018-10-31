const Apify = require('apify');

/**
 * Gets attribute as text from a ElementHandle.
 * @param {ElementHandle} element - The element to get attribute from.
 * @param {string} attr - Name of the attribute to get.
 */
async function getAttribute(element, attr){
    try{
        const prop = await element.getProperty(attr);
        return (await prop.jsonValue()).trim();
    }
    catch(e){return null;}
}

/**
 * Adds links from a page to the RequestQueue.
 * @param {Page} page - Puppeteer Page object containing the link elements.
 * @param {RequestQueue} requestQueue - RequestQueue to add the requests to.
 * @param {string} selector - A selector representing the links.
 * @param {Function} condition - Function to check if the link is to be added.
 * @param {string} label - A label for the added requests.
 * @param {Function} urlMod - Function for modifying the URL.
 * @param {Function} keyMod - Function for generating uniqueKey from the link ElementHandle.
 */
async function enqueueLinks(page, requestQueue, selector, condition, label, urlMod, keyMod){
    try{await page.waitForSelector(selector);}
    catch(e){console.log(e); return;}
    const links = await page.$$(selector);
    for(const link of links){
        const href = await getAttribute(link, 'href');
        if(href && (!condition || await condition(link))){
            await requestQueue.addRequest(new Apify.Request({
            	userData: {label: label},
            	url: urlMod ? urlMod(href) : href,
            	uniqueKey: keyMod ? (await keyMod(link)) : href
            }));
        }
    }
}

/**
 * Gets home details object from the page.
 * @param {Page} page - Page to get the object from.
 */
async function getHomeObject(page){
    const jElem = await page.$('#hdpApolloPreloadedData');
    if(jElem){
        const jText = await getAttribute(jElem, 'textContent');
        const info = JSON.parse(jText);
        const key = `ForSaleSEORenderQuery{"zpid":${zpid}}`;
        return info[key].property;
    }
    return null;
}

/**
 * Strips the home object of unnecessary attributes.
 * @param {Object} home - The home object to be stripped.
 */
function stripHomeObject(home){
    delete home.nearbyNeighborhoods;
    delete home.nearbyZipcodes;
    delete home.nearbyCities;
    delete home.nearbyHomes;
    delete home.streetAddress;
    delete home.abbreviatedAddress;
    delete home.city;
    delete home.state;
    delete home.zipcode;
    delete home.isUndisclosedAddress;
    delete home.hideZestimate;
    delete home.showDescriptionDisclaimer;
    delete home.comps;
    delete home.isListingClaimedByCurrentSignedInUser;
    delete home.homeTourHighlights;
    delete home.isCurrentSignedInAgentResponsible;
    delete home.listing_sub_type;
    home.images = home.small.map(i => i.url.replace('p_c', 'p_f'));
    delete home.small;
    for(var k in home){
        if(k.match(/Url$/)){
            delete home[k];
        }
    }
}


/**
 * Creates a RequestList with startUrls from the Actor INPUT.
 * @param {Object} input - The Actor INPUT containing startUrls.
 */
async function createRequestList(input){
    // check if attribute is an Array
    if(!Array.isArray(input.startUrls)){
        throw new Error('INPUT.startUrls must be an array!');
    }
    // convert any inconsistencies to correct format
    for(let i = 0; i < input.startUrls.length; i++){
        let request = input.startUrls[i];
        if(typeof request === 'string'){request = {url: request};}
        if((!request.userData || !request.userData.label) && request.url.indexOf('/hotel/') > -1){
            request.userData = {label: 'detail'};
        }
        request.url = addUrlParameters(request.url);
        input.startUrls[i] = request;
    }
    // create RequestList and reference startUrl
    const requestList = new Apify.RequestList({sources: input.startUrls});
    await requestList.initialize();
    return requestList;
}

/** Main function */
Apify.main(async () => {
    
    // Main Actor INPUT
    const input = await Apify.getValue('INPUT');
    
    // Create request queue
    const requestQueue = await Apify.openRequestQueue();
    
    // Create request list  
    const requestList = await createRequestList(input);

    // Simulated browser cache
    const cache = {};
    
    // Proxy configuration
    const proxyConfig = input.proxyConfig || {};
    proxyConfig.liveView = input.liveView;
    proxyConfig.headless = true;
    
    // Create crawler.
    const crawler = new Apify.PuppeteerCrawler({
        requestList,
        
        requestQueue,

        launchPuppeteerFunction: async () => {
            proxyConfig.userAgent = await Apify.utils.getRandomUserAgent();
            const browser = Apify.launchPuppeteer(proxyConfig);
        },

        // This function is executed for each request.
        // If request failes then it's retried 3 times.
        // Parameter page is Puppeteers page object with loaded page.
        handlePageFunction: async ({ page, request }) => {
            
            // Re-enqueue if the page had captcha.
            const url = await page.url();
            if(url.indexOf('captcha') > -1){
                const ud = request.userData;
                if(!ud.repeats || ud.repeats < 4){
                    console.log('re-enqueuing because of ReCaptcha...');
                    await requestQueue.addRequest(new Apify.Request({ 
                        url: request.url, 
                        uniqueKey: Math.random() + '',
                        userData: {
                            label: ud.label,
                            repeats: ud.repeats ? (ud.repeats + 1) : 1
                        } 
                    }));
                }
                else{return {error: 'Retried 5 times because of ReCaptcha.'};}
            }
            
            // Print page URL.
            console.log('open page: ' + await page.url());
            
            // Home detail page, extract data.
            if(request.userData.label === 'detail'){
                console.log('extracting home data...');
                await Apify.utils.puppeteer.injectJQuery(page);
                try{
                    const result = await getHomeObject(page);
                    if(!result){
                        await Apify.pushData({error: 'No data JSON'});
                        return null;
                    }
                    stripHomeObject(result);
                    if(!input.showFacts){delete result.homeFacts;}
                    result.url = await page.url();
                    await Apify.pushData(result);
                }
                catch(e){console.log(e);}
            }
            
            // Home list page, enqueue links.
            else{
                console.log('enqueuing home and pagination links...');
                await page.waitFor(10000);
                await enqueueLinks(page, requestQueue, 'a.hdp-link', null, 'detail');
                await enqueueLinks(page, requestQueue, '#search-pagination-wrapper a.on', null, 'page');
            }
        },

        // If request failed 4 times then this function is executed.
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed 4 times`);
        },
        
        // Function for ignoring all unnecessary requests.
        gotoFunction: async ({ page, request }) => {
            await page.setRequestInterception(true);
            
            page.on('request', async (request) => {
                const url = request.url();
                if (url.includes('.js')) request.abort();
                else if (url.includes('.png')) request.abort();
                else if (url.includes('.jpg')) request.abort();
                else if (url.includes('.gif')) request.abort();
                else if (url.includes('.css')) request.abort();
                else if (url.includes('static/fonts')) request.abort();
                else if (url.includes('js_tracking')) request.abort();
                else if (url.includes('facebook.com')) request.abort();
                else if (url.includes('googleapis.com')) request.abort();
                else{
                    // Return cached response if available
                    if(cache[url] && cache[url].expires > Date.now()){
                        await request.respond(cache[url]);
                        return;
                    }
                    request.continue();
                }
            });
            
            // Cache responses for future needs
            page.on('response', async (response) => {
                const url = response.url();
                const headers = response.headers();
                const cacheControl = headers['cache-control'] || '';
                const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
                const maxAge = maxAgeMatch && maxAgeMatch.length > 1 ? parseInt(maxAgeMatch[1], 10) : 0;
                if (maxAge && input.cacheResponses) {
                    if (!cache[url] || cache[url].expires > Date.now()) return;

                    cache[url] = {
                        status: response.status(),
                        headers: response.headers(),
                        body: buffer,
                        expires: Date.now() + (maxAge * 1000),
                    };
                }
            });
        	
        	// Hide WebDriver and return new page.
            await Apify.utils.puppeteer.hideWebDriver(page);
            return await page.goto(request.url, {timeout: 200000});
        }
    });

    // Run crawler.
    await crawler.run();
});
