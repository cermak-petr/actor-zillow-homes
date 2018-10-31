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
    const url = await page.url();
    const zpid = url.match(/(\d+)_zpid/)[1];
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
 * Splits the map into 4 rectangles to avoid limitation for 1000 results.
 * @param {Request} request - The current request.
 * @param {RequestQueue} requestQueue - RequestQueue to add new pages to.
 */
async function splitMap(request, requestQueue){
    // Get coordinates from url
    const url = request.url;
    const cRegex = /([\d\.,\-]+)_rect/;
    const coords = url.match(cRegex)[1].split(',');
    const left = parseFloat(coords[0]), top = parseFloat(coords[1]), 
          right = parseFloat(coords[2]), bottom = parseFloat(coords[3]);
    
    // Calculate new rectangles
    const rects = [
        `${left},${top},${(left + right)/2},${(top + bottom)/2}`,
        `${(left + right)/2},${top},${right},${(top + bottom)/2}`,
        `${left},${(top + bottom)/2},${(left + right)/2},${bottom}`,
        `${(left + right)/2},${(top + bottom)/2},${right},${bottom}`
    ];
    
    // Enqueue all new rectangle pages
    const level = (request.userData.level || 0) + 1;
    for(const rect of rects){
        await requestQueue.addRequest(new Apify.Request({
            url: url.replace(cRegex, rect),
            userData: {label: 'page', level}
        }));
    }
}

/**
 * Gets total number of homes found on the map.
 * @param {Page} page - The page to find the number on.
 */
async function getTotalHomes(page){
    const getNumber = () => {
        const elem = document.querySelector('#map-result-count-message');
        if(!elem){return false;}
        const match = elem.textContent.match(/[\d,]+/);
        return match ? parseInt(match[0].replace(',', '')) : null;
    };
    await page.waitFor(getNumber, {timeout: 20000});
    return await page.evaluate(getNumber);
}

/**
 * Gets total number of current search pages.
 * @param {Page} page - The page to find the number on.
 */
async function getNumberOfPages(page){
    const pLinks = await page.$$('#search-pagination-wrapper a[href]');
    if(pLinks.length > 0){
        const pText = await getAttribute(pLinks[pLinks.length - 1], 'textContent');
        return parseInt(pText);
    }
    return null;
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
            return Apify.launchPuppeteer(proxyConfig);
        },

        // This function is executed for each request.
        // If request failes then it's retried 3 times.
        // Parameter page is Puppeteers page object with loaded page.
        handlePageFunction: async ({ page, request, puppeteerPool }) => {
            
            // Re-enqueue if the page had captcha.
            const url = await page.url();
            if(url.indexOf('captcha') > -1){
                await puppeteerPool.retire(page.browser());
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
                else{console.log('retried 5 times because of ReCaptcha.');}
                return;
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
            
            // Home list page, enqueue links or split the map.
            else{
                await page.waitFor(10000);
                const level = request.userData.level || 0;
                const total = await getNumberOfPages(page);
                if(total < 20 || (input.maxLevel && level >= input.maxLevel)){
                    console.log('enqueuing home and pagination links...');
                    await enqueueLinks(page, requestQueue, 'a.hdp-link', null, 'detail');
                    const link = await page.$('#search-pagination-wrapper a:not([href])');
                    const lText = await getAttribute(link, 'textContent');
                    const pAllow = !input.maxPages || (parseInt(lText) < input.maxPages);
                    await enqueueLinks(page, requestQueue, '#search-pagination-wrapper a.on', link => pAllow, 'page');
                }
                else{
                    console.log('more than 500 results found, splitting the map...');
                    await splitMap(request, requestQueue);
                }
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
                /*if (url.includes('.js')) request.abort();
                else */if (url.includes('.png')) request.abort();
                else if (url.includes('.jpg')) request.abort();
                else if (url.includes('.gif')) request.abort();
                else if (url.includes('.css')) request.abort();
                else if (url.includes('static/fonts')) request.abort();
                //else if (url.includes('js_tracking')) request.abort();
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
