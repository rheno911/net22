// ============================================================
// NetMirror Provider — SkyStream JS Plugin
// Streams: Netflix, Disney+ Hotstar, Prime Video, SonyLiv, Aha
// ============================================================

// ----- STEP 1: MANIFEST -----
function getManifest() {
    return {
        name: "NetMirror",
        id: "com.sushan64.netmirror",
        version: 1,
        baseUrl: "https://netmirror.app",
        type: "Movie",   // covers both Movies and TV
        language: "en"
    };
}

const mainUrl = "https://netmirror.app";

// ----- STEP 2: COMMON HEADERS -----
const commonHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": mainUrl + "/",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9"
};

// ----- STEP 3: HOME PAGE -----
function getHome(callback) {
    var inputs = [
        { title: "Netflix",        url: mainUrl + "/netflix" },
        { title: "Disney+ Hotstar",url: mainUrl + "/hotstar" },
        { title: "Prime Video",    url: mainUrl + "/prime" },
        { title: "SonyLiv",        url: mainUrl + "/sonyliv" },
        { title: "Trending",       url: mainUrl + "/trending" }
    ];

    var finalResult = [];
    var pending = inputs.length;

    inputs.forEach(function(item) {
        http_get(item.url, commonHeaders, function(status, data) {
            var movies = [];
            if (status === 200 && data) {
                // Try JSON parse first (some endpoints return JSON)
                try {
                    var json = JSON.parse(data);
                    var items = json.results || json.data || json.movies || [];
                    items.forEach(function(m) {
                        movies.push({
                            name:        m.title || m.name || "",
                            link:        m.url   || m.link || (mainUrl + "/" + m.id),
                            image:       m.poster || m.image || m.thumbnail || "",
                            description: m.description || m.plot || ""
                        });
                    });
                } catch (e) {
                    // Fallback: Regex parse HTML
                    movies = parseMoviesFromHTML(data, mainUrl);
                }
            }
            finalResult.push({ title: item.title, Data: movies });
            pending--;
            if (pending === 0) {
                callback(JSON.stringify(finalResult));
            }
        });
    });
}

// ----- STEP 4: SEARCH -----
function search(query, callback) {
    var searchUrl = mainUrl + "/search?q=" + encodeURIComponent(query);
    http_get(searchUrl, commonHeaders, function(status, data) {
        var movies = [];
        if (status === 200 && data) {
            try {
                var json = JSON.parse(data);
                var items = json.results || json.data || [];
                items.forEach(function(m) {
                    movies.push({
                        name:        m.title || m.name || "",
                        link:        m.url   || m.link || (mainUrl + "/" + m.id),
                        image:       m.poster || m.image || "",
                        description: m.description || ""
                    });
                });
            } catch (e) {
                movies = parseMoviesFromHTML(data, mainUrl);
            }
        }
        callback(JSON.stringify([{ title: "Search Results", Data: movies }]));
    });
}

// ----- STEP 5: LOAD DETAILS -----
function load(url, callback) {
    http_get(url, commonHeaders, function(status, html) {
        var title       = extractRegex(html, /<title>([^<]+)</title>/);
        var description = extractRegex(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/);
        var image       = extractRegex(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/);
        var year        = extractRegex(html, /(\b20[0-9]{2}\b)/);

        // Try to extract hidden stream data or video ID embedded in page
        var embedUrl    = extractRegex(html, /["'](https?://[^"']+/(embed|player|watch)[^"']+)["']/);
        var streamData  = embedUrl || url;

        callback(JSON.stringify({
            url:         url,
            data:        streamData,
            title:       title       || "Unknown Title",
            description: description || "",
            image:       image       || "",
            year:        year ? parseInt(year) : null
        }));
    });
}

// ----- STEP 6: LOAD STREAMS -----
function loadStreams(url, callback) {
    // Fetch the page to find the real stream/embed
    http_get(url, commonHeaders, function(status, html) {
        var streams = [];

        if (status === 200 && html) {
            // Pattern 1: Direct MP4 links
            var mp4Regex = /["'](https?://[^"']+.mp4[^"']*)["']/g;
            var match;
            while ((match = mp4Regex.exec(html)) !== null) {
                streams.push({
                    name:    "Direct MP4",
                    url:     match[1],
                    headers: commonHeaders
                });
            }

            // Pattern 2: M3U8 HLS streams
            var m3u8Regex = /["'](https?://[^"']+.m3u8[^"']*)["']/g;
            while ((match = m3u8Regex.exec(html)) !== null) {
                streams.push({
                    name:    "HLS Stream",
                    url:     match[1],
                    headers: commonHeaders
                });
            }

            // Pattern 3: Hidden JS variable (e.g., var source = "...")
            var srcVarRegex = /vars+(?:source|stream|videoUrl|src|file)s*=s*["']([^"']+)["']/g;
            while ((match = srcVarRegex.exec(html)) !== null) {
                var val = match[1];
                // Skip TRUE/FALSE config flags (from RingZ fix lesson)
                if (val === "true" || val === "false" || val === "TRUE" || val === "FALSE") continue;
                if (val.startsWith("http")) {
                    streams.push({
                        name:    "JS Variable Stream",
                        url:     val,
                        headers: commonHeaders
                    });
                }
            }

            // Pattern 4: If an embed URL is found, do a second fetch
            var embedMatch = /["'](https?://[^"']+/(?:embed|player|iframe)[^"']*)["']/.exec(html);
            if (embedMatch && streams.length === 0) {
                var embedUrl = embedMatch[1];
                var embedHeaders = Object.assign({}, commonHeaders, { "Referer": url });
                http_get(embedUrl, embedHeaders, function(eStatus, eHtml) {
                    if (eStatus === 200 && eHtml) {
                        var innerM3u8 = /["'](https?://[^"']+.m3u8[^"']*)["']/.exec(eHtml);
                        if (innerM3u8) {
                            streams.push({
                                name:    "Embed HLS",
                                url:     innerM3u8[1],
                                headers: embedHeaders
                            });
                        }
                        var innerMp4 = /["'](https?://[^"']+.mp4[^"']*)["']/.exec(eHtml);
                        if (innerMp4) {
                            streams.push({
                                name:    "Embed MP4",
                                url:     innerMp4[1],
                                headers: embedHeaders
                            });
                        }
                    }
                    callback(JSON.stringify(streams));
                });
                return; // Wait for embed fetch callback
            }
        }

        callback(JSON.stringify(streams));
    });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Extracts first capture group from regex pattern against text.
 * Returns null if no match.
 */
function extractRegex(text, pattern) {
    if (!text) return null;
    var match = pattern.exec(text);
    return match ? match[1].trim() : null;
}

/**
 * Generic HTML scraper: extracts movie cards using common
 * anchor+image+title patterns found on most streaming aggregators.
 */
function parseMoviesFromHTML(html, base) {
    var movies = [];
    // Match anchor tags with href that look like content links
    var cardRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([sS]*?)</a>/g;
    var match;
    while ((match = cardRegex.exec(html)) !== null) {
        var href    = match[1];
        var inner   = match[2];
        if (!href || href === "#" || href.indexOf("http") === -1 && href.indexOf("/") !== 0) continue;

        var imgMatch   = /src=["']([^"']+.(jpg|png|webp)[^"']*)["']/.exec(inner);
        var titleMatch = /<(?:h[1-6]|span|div|p)[^>]*>([^<]{3,80})</(?:h[1-6]|span|div|p)>/.exec(inner);

        var absLink = href.startsWith("http") ? href : base + href;

        if (titleMatch) {
            movies.push({
                name:        titleMatch[1].trim(),
                link:        absLink,
                image:       imgMatch ? imgMatch[1] : "",
                description: ""
            });
        }
    }
    return movies;
}
