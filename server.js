import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";

const app = express();
app.use(express.json());
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

let mongoClient = null;
let ratingCollection = null;
const inMemoryRatings = new Map();

async function connectToMongo() {
    if (!process.env.MONGODB_URI) {
        return null;
    }

    if (mongoClient && ratingCollection) {
        return ratingCollection;
    }

    try {
        mongoClient = new MongoClient(process.env.MONGODB_URI);
        await mongoClient.connect();

        const dbName = process.env.MONGODB_DB || "music-site-ratings";
        const database = mongoClient.db(dbName);
        ratingCollection = database.collection("ratings");
        await ratingCollection.createIndex({ slug: 1 }, { unique: true });
        console.log(`MongoDB connected to database: ${dbName}`);
    } catch (error) {
        console.warn("MongoDB unavailable; using in-memory ratings instead.", error.message);
        mongoClient = null;
        ratingCollection = null;
        return null;
    }

    return ratingCollection;
}

function normalizeRating(value) {
    const rating = Number(value);
    if (!Number.isFinite(rating)) {
        return null;
    }

    if (rating < 1 || rating > 5) {
        return null;
    }

    return Number(rating.toFixed(1));
}

function buildSlug(rawValue) {
    const text = String(rawValue || "").trim();
    if (!text) {
        return "album:untitled";
    }

    const trimmed = text.replace(/^album\s*[:_-]+/i, "").trim();
    const parts = trimmed.split(":").map(part => part.trim()).filter(Boolean);

    if (parts.length >= 2) {
        const artist = parts.slice(0, -1).join(":").trim();
        const album = parts[parts.length - 1].trim();
        if (artist && album) {
            return `album:${artist}:${album}`;
        }
    }

    return text;
}

function getUserIdFromRequest(req) {
    const value = req.body?.userId ?? req.query?.userId ?? req.headers["x-user-id"];
    const text = String(value ?? "").trim();
    return text || null;
}

function summarizeVotes(votes) {
    const values = Object.values(votes ?? {})
        .map(value => Number(value))
        .filter(value => Number.isFinite(value) && value >= 1 && value <= 5);

    if (!values.length) {
        return { average: null, totalVotes: 0 };
    }

    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
        average: Number(average.toFixed(1)),
        totalVotes: values.length
    };
}

function getInMemoryRatingDocument(slug) {
    const doc = inMemoryRatings.get(slug);
    if (!doc || typeof doc !== "object") {
        return { slug, votes: {} };
    }

    return {
        slug,
        votes: typeof doc.votes === "object" ? doc.votes : {},
        updatedAt: doc.updatedAt ?? null,
        createdAt: doc.createdAt ?? null
    };
}

async function readRatingDocument(slug) {
    try {
        const collection = await connectToMongo();
        if (!collection) {
            return getInMemoryRatingDocument(slug);
        }

        const document = await collection.findOne({ slug });
        return {
            slug,
            votes: document && typeof document.votes === "object" ? document.votes : {},
            updatedAt: document?.updatedAt ?? null,
            createdAt: document?.createdAt ?? null
        };
    } catch (error) {
        console.warn("Could not read ratings from MongoDB; using in-memory fallback.", error.message);
        return getInMemoryRatingDocument(slug);
    }
}

async function writeRatingDocument(slug, userId, rating) {
    const current = getInMemoryRatingDocument(slug);

    try {
        const collection = await connectToMongo();
        if (!collection) {
            const votes = { ...(current.votes || {}) };
            votes[userId] = rating;
            const timestamp = new Date();
            const document = {
                slug,
                votes,
                createdAt: current.createdAt ?? timestamp,
                updatedAt: timestamp
            };
            inMemoryRatings.set(slug, document);
            return document;
        }

        const existing = await collection.findOne({ slug });
        const voteMap = existing && typeof existing.votes === "object" ? { ...existing.votes } : {};
        voteMap[userId] = rating;

        const timestamp = new Date();
        const updated = await collection.findOneAndUpdate(
            { slug },
            {
                $set: {
                    slug,
                    votes: voteMap,
                    updatedAt: timestamp
                },
                $setOnInsert: {
                    createdAt: timestamp
                }
            },
            {
                upsert: true,
                returnDocument: "after"
            }
        );

        const saved = updated?.value ?? {
            slug,
            votes: voteMap,
            createdAt: timestamp,
            updatedAt: timestamp
        };

        inMemoryRatings.set(slug, saved);
        return saved;
    } catch (error) {
        console.warn("Could not write ratings to MongoDB; using in-memory fallback.", error.message);
        const votes = { ...(current.votes || {}) };
        votes[userId] = rating;
        const timestamp = new Date();
        const document = {
            slug,
            votes,
            createdAt: current.createdAt ?? timestamp,
            updatedAt: timestamp
        };
        inMemoryRatings.set(slug, document);
        return document;
    }
}

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
app.get(["/img/Newtypeicon.png", "/img/newtypeicon.png"], (req, res) => {
    res.sendFile(path.join(__dirname, "img", "newtypeicon.png"));
});
app.get(["/img/Record.png", "/img/record.png"], (req, res) => {
    res.sendFile(path.join(__dirname, "img", "record.png"));
});
app.get("/img/placeholder.png", (req, res) => {
    res.sendFile(path.join(__dirname, "img", "placeholder.png"));
});
app.get("/3placeholder.png", (req, res) => {
    res.sendFile(path.join(__dirname, "img", "placeholder.png"));
});

app.get("/api/ratings/recent", async (req, res) => {
    try {
        const collection = await connectToMongo();
        if (collection) {
            const docs = await collection.find({}).sort({ updatedAt: -1 }).toArray();
            const items = docs.map(doc => {
                const voteMap = doc?.votes && typeof doc.votes === "object" ? doc.votes : {};
                const summary = summarizeVotes(voteMap);
                return {
                    slug: doc.slug,
                    average: summary.average,
                    totalVotes: summary.totalVotes,
                    updatedAt: doc.updatedAt ?? null
                };
            });
            res.json(items);
            return;
        }

        const items = [...inMemoryRatings.values()]
            .sort((a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0))
            .map(doc => {
                const voteMap = doc?.votes && typeof doc.votes === "object" ? doc.votes : {};
                const summary = summarizeVotes(voteMap);
                return {
                    slug: doc.slug,
                    average: summary.average,
                    totalVotes: summary.totalVotes,
                    updatedAt: doc.updatedAt ?? null
                };
            });

        res.json(items);
    } catch (error) {
        console.warn("Could not fetch recent ratings.", error.message);
        res.status(500).json({ error: "Could not fetch recent ratings." });
    }
});

app.get("/api/ratings/:slug", async (req, res) => {
    const slug = buildSlug(req.params.slug);
    const userId = getUserIdFromRequest(req);
    const document = await readRatingDocument(slug);
    const voteMap = document && typeof document.votes === "object" ? document.votes : {};
    const community = summarizeVotes(voteMap);

    res.json({
        slug,
        userRating: userId ? voteMap[userId] ?? null : null,
        communityRating: community.average,
        totalVotes: community.totalVotes,
        lastUpdated: document?.updatedAt ?? null
    });
});

app.post(["/api/ratings", "/api/ratings/:slug"], async (req, res) => {
    const slug = buildSlug(req.params.slug || req.body?.slug || "untitled");
    const rating = normalizeRating(req.body?.rating ?? req.query?.rating);
    const userId = getUserIdFromRequest(req);

    if (rating === null) {
        res.status(400).json({ error: "Rating must be a whole number between 1 and 5." });
        return;
    }

    if (!userId) {
        res.status(400).json({ error: "A browser userId is required for personal ratings." });
        return;
    }

    const document = await writeRatingDocument(slug, userId, rating);
    const votes = document && typeof document.votes === "object" ? document.votes : {};
    const community = summarizeVotes(votes);

    res.json({
        slug,
        userRating: rating,
        communityRating: community.average,
        totalVotes: community.totalVotes,
        lastUpdated: document?.updatedAt ?? null
    });
});

app.put(["/api/ratings", "/api/ratings/:slug"], async (req, res) => {
    const slug = buildSlug(req.params.slug || req.body?.slug || "untitled");
    const rating = normalizeRating(req.body?.rating ?? req.query?.rating);
    const userId = getUserIdFromRequest(req);

    if (rating === null) {
        res.status(400).json({ error: "Rating must be a whole number between 1 and 5." });
        return;
    }

    if (!userId) {
        res.status(400).json({ error: "A browser userId is required for personal ratings." });
        return;
    }

    const document = await writeRatingDocument(slug, userId, rating);
    const votes = document && typeof document.votes === "object" ? document.votes : {};
    const community = summarizeVotes(votes);

    res.json({
        slug,
        userRating: rating,
        communityRating: community.average,
        totalVotes: community.totalVotes,
        lastUpdated: document?.updatedAt ?? null
    });
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
        if (value === undefined || value === null) {
            continue;
        }
        url.searchParams.set(key, String(value));
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