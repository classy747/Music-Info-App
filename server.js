import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lastFmMethods = new Set([
    "artist.getinfo",
    "artist.gettopalbums",
    "album.search",
    "album.getinfo",
    "chart.gettopartists",
    "tag.gettopalbums",
    "track.getinfo"
]);

// Serve only the static frontend files (index.html, script.js,
// styles.css) from the project root. We target individual files
// instead of the whole directory so node_modules/.env are never
// exposed to the public.
app.get(["/", "/index.html"], (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/script.js", (req, res) => {
    res.sendFile(path.join(__dirname, "script.js"));
});
app.get("/styles.css", (req, res) => {
    res.sendFile(path.join(__dirname, "styles.css"));
});
app.get("/img/placeholder.png", (req, res) => {
    res.sendFile(path.join(__dirname, "img", "placeholder.png"));
});



async function requestLastFm(method, params) {
    if (!process.env.LASTFM_KEY) {
        throw new Error("LASTFM_KEY is not configured.");
    }
    const url = new URL("https://ws.audioscrobbler.com/2.0/");
    url.searchParams.set("method", method);
    url.searchParams.set("api_key", process.env.LASTFM_KEY);
    url.searchParams.set("format", "json");

    for (const [key, value] of Object.entries(params)) {
        if (typeof value === "string") {
            url.searchParams.set(key, value);
        }
    }

    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || data.error) {
        throw new Error(data.message || `Last.fm request failed: ${response.status}`);
    }
    return data;
}

app.get("/api/lastfm", async (req, res) => {
    const method = req.query.method;
    if (typeof method !== "string" || !lastFmMethods.has(method.toLowerCase())) {
        res.status(400).json({ error: "Unsupported Last.fm method." });
        return;
    }

    const params = { ...req.query };
    delete params.method;
    try {
        res.json(await requestLastFm(method, params));
    } catch {
        console.error(`Last.fm proxy request failed for ${method}.`);
        res.status(502).json({ error: "Could not retrieve data from Last.fm." });
    }
});

// Keep these routes available for existing clients.
app.get("/api/albums", async (req, res) => {
    try {
        res.json(await requestLastFm("tag.gettopalbums", {
            tag: "rock",
            limit: "25",
            page: String(req.query.page || 1)
        }));
    } catch {
        console.error("Last.fm top albums request failed.");
        res.status(502).json({ error: "Could not retrieve albums from Last.fm." });
    }
});

// ARTIST INFO
app.get("/api/artist/:artist", async (req, res) => {
    try {
        res.json(await requestLastFm("artist.getinfo", {
            artist: req.params.artist,
            autocorrect: "1"
        }));
    } catch {
        console.error("Last.fm artist request failed.");
        res.status(502).json({ error: "Could not retrieve artist information from Last.fm." });
    }
});



// ARTIST ALBUMS
app.get("/api/artist/:artist/albums", async (req, res) => {
    try {
        res.json(await requestLastFm("artist.gettopalbums", {
            artist: req.params.artist,
            autocorrect: "1",
            limit: "25"
        }));
    } catch {
        console.error("Last.fm artist albums request failed.");
        res.status(502).json({ error: "Could not retrieve artist albums from Last.fm." });
    }
});



// ALBUM SEARCH
app.get("/api/album/search/:album", async (req, res) => {
    try {
        res.json(await requestLastFm("album.search", {
            album: req.params.album,
            limit: "25"
        }));
    } catch {
        console.error("Last.fm album search failed.");
        res.status(502).json({ error: "Could not search albums on Last.fm." });
    }
});



const port = process.env.PORT || 3000;

// Vercel runs the app as a serverless function and imports the
// exported `app`, so we must export it. We only call `listen`
// when running locally (npm run start) so it doesn't conflict
// with Vercel's runtime.
if (process.env.NODE_ENV !== "production") {
    app.listen(port, () => {
        console.log(`Express is live at http://localhost:${port}`);
    });
}

export default app;