# actor-zillow-homes

Apify actor for extracting data about homes from Zillow.com.

This actor extracts home info from zillow.com. The way it works is by recursively splitting the map  
4 ways to overcome the limit of 500 results per search. To limit the number of outputted results,  
you can set the maximum depth of the 4-way split zooms. This is done using the `maxLevel` attrubite.  

In order for the actor to work correctly, you need to use only start URLs containing the map coordinates.  
For example, something like this is fine:  
`https://www.zillow.com/homes/for_sale/globalrelevanceex_sort/34.14161,-118.3882,34.10118,-118.446565_rect/13_zm/`

## Input attributes

Input is a JSON object with the following properties:

```javascript
{
    "startUrls": START_URL_ARRAY,
    "proxyConfig": APIFY_PROXY_CONFIG,
    "maxLevel": MAX_ZOOM_SPLIT_DEPTH,
    "showFacts": INCLUDE_FACTS_ARRAY,
    "liveView": ENABE_LIVE_VIEW
}
```
  
  
* `startUrls` is the only required attribute. This an array of start URLs.  It should look like this:  
```javascript
"startUrls": [
    "https://www.zillow.com/homes/for_sale/globalrelevanceex_sort/34.442026,-117.48642,33.723197,-119.354096_rect/8_zm/",
    "https://www.zillow.com/homes/for_sale/globalrelevanceex_sort/35.05698,-111.838074,32.458791,-115.573426_rect/7_zm/",
    "https://www.zillow.com/homes/for_sale/globalrelevanceex_sort/45.782848,-96.737366,43.560491,-100.472718_rect/7_zm/",
    ...
]
```  
* `proxyConfig` define Apify proxy configuration, it should respect this format:  
```javascript
"proxyConfig": [
    "useApifyProxy": true,
    "apifyProxyGroups": [
        "RESIDENTIAL",
        ...
    ]
]
```  
* `maxLevel` sets the maximum depth of the 4-way split zooms.  
* `showFacts` sets if the __facts__ array will be added to each result.  
* `liveView` sets if Apify live view will be enabled.  
