const baseURL = "/api/lastfm";
const imagePlaceholder = "/img/placeholder.png";

const albumGrid = document.getElementById("albumGrid");
const popularAlbumGenres = [
    { label: "Rock", tag: "rock" },
    { label: "Pop", tag: "pop" },
    { label: "Metal", tag: "metal" },
    { label: "R&B", tag: "r&b" },
    { label: "Rap / Hip-Hop", tag: "hip-hop" },
    { label: "Classic Rock", tag: "classic rock" },
    { label: "Indie", tag: "indie" },
    { label: "Electronic", tag: "electronic" },
    { label: "Jazz", tag: "jazz" },
    { label: "Country", tag: "country" }
];
const carouselTrack = document.getElementById("carouselTrack");
const recentRatingsTrack = document.getElementById("recentRatingsTrack");
const topArtistsSection = document.getElementById("topArtistsSection");
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const artistToggle = document.getElementById("artistToggle");
const albumToggle = document.getElementById("albumToggle");
const searchToggle = document.querySelector(".search-toggle");
const artistInfo = document.getElementById("artistInfo");
const status = document.getElementById("status");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");

const albumRatingSessions = new Map();

let searchType = "artist";
let previousView = "home";
let previousSearch = "";
let loadingRequestId = 0;
let activeAlbumLoads = 0;
let selectedPopularGenre = "rock";
let popularAlbumsRequestId = 0;
let popularGenreFilter;
let popularGenreWrap;

function startLoading(message) {
    const requestId = ++loadingRequestId;
    status.textContent = message;
    status.hidden = true;
    loadingText.textContent = message;
    loadingOverlay.hidden = false;
    return requestId;
}

function updateLoadingStatus(requestId, message) {
    if (requestId !== loadingRequestId) return;

    status.textContent = message;
    loadingText.textContent = message;
}

function finishLoading(requestId) {
    if (requestId !== loadingRequestId) return;

    loadingOverlay.hidden = true;
    status.hidden = true;
    status.textContent = "";
}

async function returnHomeAfterRating() {
    const requestId = startLoading("Rating saved. Returning to the homepage...");
    const loadingRecord = loadingOverlay.querySelector(".loading-record");
    loadingRecord.classList.add("rating-completion");

    try {
        await Promise.all([
            new Promise(resolve => window.setTimeout(resolve, 3000)),
            getAlbums()
        ]);
    } finally {
        loadingRecord.classList.remove("rating-completion");
        finishLoading(requestId);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
}

async function lastFm(method, params = {}) {
    const query = new URLSearchParams({
        method,
        ...params
    });

    const response = await fetch(`${baseURL}?${query}`);

    if (!response.ok) {
        let message = `Last.fm request failed: ${response.status}`;

        try {
            const data = await response.json();
            if (data?.error) {
                message = data.error;
            }
        } catch {
            // Ignore invalid JSON error payloads.
        }

        throw new Error(message);
    }

    return response.json();
}

function getImage(images) {
    if (!Array.isArray(images)) return "";

    const placeholder = "2a96cbd8b46e442fc41c2b86b821562f";

    const image = [...images].reverse().find(item =>
        item?.["#text"] &&
        !item["#text"].includes(placeholder)
    );

    return image?.["#text"].replace("http://", "https://") || "";
}

async function getArtistImage(artist) {
    const image = getImage(artist.image);
    if (image) return image;

    try {
        const data = await lastFm("artist.getinfo", {
            artist: artist.name,
            autocorrect: 1
        });

        const fallback = getImage(data.artist?.image);
        if (fallback) return fallback;
    } catch (error) {
        console.warn("Last.fm artist image unavailable:", error);
    }

    try {
        const response = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artist.name)}`
        );

        if (response.ok) {
            const data = await response.json();
            if (data.thumbnail?.source) return data.thumbnail.source;
        }
    } catch (error) {
        console.warn("Wikipedia image unavailable:", error);
    }

    return "";
}

function createImage(url, alt) {
    const image = document.createElement("img");
    const placeholderURL = new URL(imagePlaceholder, document.baseURI).href;
    image.alt = alt;
    image.loading = "lazy";
    if (!url) {
        image.classList.add("image-fallback");
    }
    image.addEventListener("error", () => {
        if (image.src !== placeholderURL) {
            image.classList.add("image-fallback");
            image.src = placeholderURL;
        }
    }, { once: true });
    image.src = url || placeholderURL;

    return image;
}

function getDurationMs(value) {
    if (typeof value === "string" && value.includes(":")) {
        const parts = value.split(":").map(Number);
        if (parts.length === 2 && parts.every(Number.isFinite)) {
            return (parts[0] * 60 + parts[1]) * 1000;
        }
    }

    const duration = Number(value);
    if (!Number.isFinite(duration) || duration <= 0) return 0;

    return duration < 10000 ? duration * 1000 : duration;
}

function createMetadataRow(label, value) {
    if (!value) return null;

    const row = document.createElement("p");
    const strong = document.createElement("strong");

    strong.textContent = `${label}: `;
    row.append(strong, document.createTextNode(String(value)));

    return row;
}

function getVisitorId() {
    const key = "deepCutsVisitorId";
    let stored = localStorage.getItem(key);

    if (!stored) {
        stored = typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(key, stored);
    }

    return stored;
}

async function getAlbumRating(slug) {
    try {
        const response = await fetch(`/api/ratings/${encodeURIComponent(slug)}?userId=${encodeURIComponent(getVisitorId())}`);
        if (!response.ok) {
            return { userRating: null, communityRating: null, totalVotes: 0 };
        }

        return await response.json();
    } catch (error) {
        console.warn("Could not load album rating:", error);
        return { userRating: null, communityRating: null, totalVotes: 0 };
    }
}

async function submitAlbumRating(slug, rating) {
    try {
        const response = await fetch(`/api/ratings/${encodeURIComponent(slug)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug, rating, userId: getVisitorId() })
        });

        if (!response.ok) {
            throw new Error(`Rating submission failed: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.warn("Could not save album rating:", error);
        return null;
    }
}

function formatCommunityRatingText(result) {
    if (result?.communityRating == null) {
        return "Not rated yet";
    }

    const votes = result.totalVotes ?? 0;
    return `Community rating: ${Number(result.communityRating).toFixed(1)}/5 (${votes} vote${votes === 1 ? "" : "s"})`;
}

function formatAlbumRatingText(result) {
    if (result?.userRating != null) {
        return `Your rating: ${Number(result.userRating).toFixed(1)}/5`;
    }

    return formatCommunityRatingText(result);
}

function getAlbumRatingSession(key, tracks) {
    if (!albumRatingSessions.has(key)) {
        albumRatingSessions.set(key, {
            index: 0,
            ratings: new Array(tracks.length).fill(null)
        });
    }

    return albumRatingSessions.get(key);
}

function updateAlbumRatingSummary(summaryEl, key) {
    const session = albumRatingSessions.get(key);

    if (!session || !session.ratings.some(value => value !== null)) {
        summaryEl.textContent = "Not rated yet";
        return;
    }

    const validRatings = session.ratings.filter(value => value !== null);
    const average = validRatings.reduce((sum, value) => sum + value, 0) / validRatings.length;
    summaryEl.textContent = `Your rating: ${average.toFixed(1)}/5`;
}

function createAlbumRatingPanel({ key, tracks, summaryEl, highlightCurrentTrack }) {
    const session = getAlbumRatingSession(key, tracks);
    const panel = document.createElement("div");
    panel.className = "album-rating-panel";

    const trackMeta = document.createElement("div");
    trackMeta.className = "album-rating-track-meta";

    const currentTrack = document.createElement("div");
    currentTrack.className = "album-rating-current";

    const trackTitle = document.createElement("h3");
    trackTitle.className = "album-rating-title";

    const ratingValue = document.createElement("p");
    ratingValue.className = "album-rating-value";

    const starsWrap = document.createElement("div");
    starsWrap.className = "album-rating-stars";
    const stars = [];

    const controls = document.createElement("div");
    controls.className = "album-rating-controls";

    const prevButton = document.createElement("button");
    prevButton.type = "button";
    prevButton.className = "album-rating-button secondary";
    prevButton.textContent = "Previous";

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "album-rating-button";
    nextButton.textContent = "Next";

    const statusText = document.createElement("p");
    statusText.className = "album-rating-status";
    statusText.textContent = "";

    let currentSelection = session.ratings[session.index] ?? 0;

    function renderStars(rating) {
        stars.forEach((star, index) => {
            star.classList.toggle("selected", index < rating);
            star.classList.toggle("preview", false);
        });
    }

    function renderPanel() {
        const track = tracks[session.index];
        currentSelection = session.ratings[session.index] ?? 0;

        trackTitle.textContent = track.name;
        ratingValue.textContent = currentSelection ? `${currentSelection}/5` : "Select a rating";
        renderStars(currentSelection);
        prevButton.disabled = session.index === 0;
        nextButton.textContent = session.index === tracks.length - 1 ? "Finish" : "Next";
        statusText.textContent = "";
        if (typeof highlightCurrentTrack === "function") {
            highlightCurrentTrack(session.index);
        }
    }

    for (let value = 1; value <= 5; value += 1) {
        const star = document.createElement("button");
        star.type = "button";
        star.className = "album-rating-star";
        star.textContent = "★";
        star.setAttribute("aria-label", `Rate ${value} out of 5`);

        star.addEventListener("mouseenter", () => {
            renderStars(value);
            star.classList.add("preview");
        });

        star.addEventListener("mouseleave", () => {
            renderStars(currentSelection);
        });

        star.addEventListener("click", () => {
            currentSelection = value;
            session.ratings[session.index] = value;
            ratingValue.textContent = `${value}/5`;
            renderStars(value);
            statusText.textContent = "Rating selected.";
            if (typeof highlightCurrentTrack === "function") {
                highlightCurrentTrack(session.index);
            }
        });

        stars.push(star);
        starsWrap.appendChild(star);
    }

    prevButton.addEventListener("click", () => {
        if (session.index === 0) {
            return;
        }

        session.index -= 1;
        renderPanel();
    });

    nextButton.addEventListener("click", () => {
        if (!currentSelection) {
            statusText.textContent = "Please select a rating before continuing.";
            return;
        }

        session.ratings[session.index] = currentSelection;

        if (session.index === tracks.length - 1) {
            const validRatings = session.ratings.filter(value => value !== null);
            const total = validRatings.reduce((sum, value) => sum + value, 0);
            const average = validRatings.length ? total / validRatings.length : 0;
            updateAlbumRatingSummary(summaryEl, key);

            panel.replaceChildren();

            const finalWrap = document.createElement("div");
            finalWrap.className = "album-rating-summary-panel";

            const finalLabel = document.createElement("p");
            finalLabel.className = "album-rating-progress";
            finalLabel.textContent = "Album rating";

            const finalScore = document.createElement("h3");
            finalScore.className = "album-rating-final-score";
            finalScore.textContent = `${average.toFixed(1)}/5`;

            const submitButton = document.createElement("button");
            submitButton.type = "button";
            submitButton.className = "album-rating-button";
            submitButton.textContent = "Save collective rating";

            const resetButton = document.createElement("button");
            resetButton.type = "button";
            resetButton.className = "album-rating-button secondary";
            resetButton.textContent = "Edit ratings";

            resetButton.addEventListener("click", () => {
                session.index = 0;
                panel.replaceChildren();
                panel.append(currentTrack, ratingValue, controls, statusText);
                renderPanel();
            });

            submitButton.addEventListener("click", async () => {
                submitButton.disabled = true;
                const result = await submitAlbumRating(key, Number(average.toFixed(1)));
                if (result) {
                    summaryEl.textContent = formatAlbumRatingText(result);
                    finalScore.textContent = result.communityRating != null ? `${result.communityRating.toFixed(1)}/5` : `${Number(result.userRating ?? 0).toFixed(1)}/5`;
                    statusText.textContent = "Your rating was saved. Returning to the homepage...";
                    getRecentRatings();
                    await returnHomeAfterRating();
                } else {
                    submitButton.disabled = false;
                    statusText.textContent = "Could not save your rating.";
                }
            });

            finalWrap.append(finalLabel, finalScore, submitButton, resetButton, statusText);
            panel.appendChild(finalWrap);
            updateAlbumRatingSummary(summaryEl, key);
            return;
        }

        session.index += 1;
        renderPanel();
    });

    trackMeta.appendChild(trackTitle);
    controls.append(prevButton, nextButton);
    currentTrack.append(trackMeta, starsWrap);
    panel.append(currentTrack, ratingValue, controls, statusText);
    renderPanel();

    panel.setTrackIndex = (index) => {
        const trackIndex = Number(index);
        if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= tracks.length) {
            return;
        }

        const nextUnratedIndex = session.ratings.findIndex(value => value === null);
        if (nextUnratedIndex !== -1 && trackIndex > nextUnratedIndex) {
            panel.showStatus("Rate the tracks above before continuing.");
            return;
        }

        session.index = trackIndex;
        if (!panel.contains(currentTrack)) {
            panel.replaceChildren(currentTrack, ratingValue, controls, statusText);
        }
        renderPanel();
        if (typeof highlightCurrentTrack === "function") {
            highlightCurrentTrack(session.index);
        }
    };
    panel.showStatus = message => {
        statusText.textContent = message;
    };

    return panel;
}

function getGenres(data) {
    return Array.isArray(data?.genres)
        ? data.genres.map(genre => genre.name).filter(Boolean).join(", ")
        : "";
}

async function musicBrainz(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.warn("MusicBrainz request failed:", error);
        return null;
    }
}

function slugToDisplayName(slug) {
    const cleaned = String(slug || "")
        .replace(/^album[-:_]+/i, "")
        .replace(/^album\s+/i, "");
    const words = cleaned.split(/[-_]+/).filter(Boolean);
    if (!words.length) return "Untitled album";

    return words
        .map(word => word.toLowerCase() === "to" ? "to" : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}

function parseAlbumSlugParts(slug) {
    const raw = String(slug || "").trim();
    if (!raw) {
        return { title: "Untitled album", artist: "Community pick" };
    }

    const candidate = raw.replace(/^album\s*[:_-]+/i, "").trim();
    const canonicalParts = candidate.split(":").map(part => part.trim()).filter(Boolean);

    if (canonicalParts.length >= 2) {
        const artist = canonicalParts.slice(0, -1).join(":");
        const title = canonicalParts[canonicalParts.length - 1];
        return {
            title: title || "Untitled album",
            artist: artist || "Community pick"
        };
    }

    const cleaned = candidate.replace(/^album\s+/i, "").trim();
    const words = cleaned.split(/[-_]+/).filter(Boolean);
    if (!words.length) {
        return { title: "Untitled album", artist: "Community pick" };
    }

    const titleWordCount = words.length > 3 ? 3 : Math.max(1, words.length - 1);
    const titleWords = words.slice(-titleWordCount);
    const title = titleWords
        .map(word => word.toLowerCase() === "to" ? "to" : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");

    const artistWords = words.slice(0, Math.max(0, words.length - titleWordCount));
    const artist = artistWords.length ? artistWords
        .map(word => word.toLowerCase() === "to" ? "to" : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
        : "Community pick";

    return { title, artist };
}

async function findRecentAlbumMatch(term, preferredArtist = "") {
    const normalizedTerm = String(term || "").trim();
    if (!normalizedTerm) return null;

    try {
        const data = await lastFm("album.search", { album: normalizedTerm, limit: 10 });
        const results = data.results?.albummatches?.album;
        const albums = Array.isArray(results) ? results : results ? [results] : [];

        const preferred = String(preferredArtist || "").trim();
        const exact = albums.find(album => {
            const albumName = String(album?.name || "").trim().toLowerCase();
            const matchName = normalizedTerm.toLowerCase();
            const sameName = albumName === matchName || albumName.includes(matchName) || matchName.includes(albumName);
            if (!sameName) return false;
            if (!preferred || preferred === "Community pick") return true;
            return String(album?.artist || "").trim().toLowerCase() === preferred.toLowerCase();
        });

        if (exact) return exact;
        return albums[0] || null;
    } catch (error) {
        console.warn("Could not resolve recent album metadata:", error);
        return null;
    }
}

async function getRecentRatings() {
    try {
        const response = await fetch("/api/ratings/recent");
        if (!response.ok) {
            return;
        }

        const items = await response.json();
        if (!Array.isArray(items) || !recentRatingsTrack) {
            return;
        }

        recentRatingsTrack.replaceChildren();
        if (!items.length) {
            return;
        }

        const cards = await Promise.all(items.map(async item => {
            const { title, artist } = parseAlbumSlugParts(item.slug);
            const match = await findRecentAlbumMatch(title, artist === "Community pick" ? "" : artist);
            const card = document.createElement("div");
            card.className = "carousel-item";

            const image = createImage(getImage(match?.image) || imagePlaceholder, `${title} cover`);
            card.appendChild(image);

            const titleEl = document.createElement("h3");
            titleEl.textContent = title;

            const meta = document.createElement("p");
            meta.textContent = match?.artist || artist || "Community pick";

            const rating = document.createElement("p");
            rating.textContent = item.average != null
                ? `${Number(item.average).toFixed(1)}/5 from ${item.totalVotes} vote${item.totalVotes === 1 ? "" : "s"}`
                : "Not rated yet";

            card.append(titleEl, meta, rating);

            card.addEventListener("click", async () => {
                if (match?.name && match?.artist) {
                    showAlbum(match.artist, match.name, () => getRecentRatings());
                    return;
                }

                searchInput.value = title;
                setSearchType("album");
                searchAlbum(title);
            });

            return card;
        }));

        recentRatingsTrack.append(...cards);
    } catch (error) {
        console.warn("Recent ratings carousel unavailable:", error);
    }
}

async function getTopArtists() {
    try {
        const data = await lastFm("chart.gettopartists", { limit: 20 });
        const artists = data.artists?.artist;

        if (!Array.isArray(artists)) return;

        carouselTrack.replaceChildren();

        const cards = await Promise.all(artists.map(async artist => {
            const card = document.createElement("div");
            card.className = "carousel-item";

            const imageURL = await getArtistImage(artist);
            const image = createImage(imageURL, `${artist.name} portrait`);

            if (image) card.appendChild(image);

            const title = document.createElement("h3");
            title.textContent = artist.name;

            const listeners = document.createElement("p");
            listeners.textContent =
                `${Number(artist.listeners || 0).toLocaleString()} listeners`;

            card.append(title, listeners);

            card.addEventListener("click", () => {
                searchInput.value = artist.name;
                setSearchType("artist");
                showArtist(artist.name);
            });

            return card;
        }));

        carouselTrack.append(...cards);
    } catch (error) {
        console.error(error);
    }
}

function ensurePopularGenreFilter() {
    if (popularGenreFilter) return;

    popularGenreWrap = document.createElement("div");
    popularGenreWrap.className = "popular-genre-wrap";

    popularGenreFilter = document.createElement("div");
    popularGenreFilter.className = "popular-genre-scroll";
    popularGenreFilter.setAttribute("role", "group");
    popularGenreFilter.setAttribute("aria-label", "Filter popular albums by genre");
    enableHorizontalScrolling(popularGenreFilter);

    popularAlbumGenres.forEach(({ label, tag }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "popular-genre-button";
        button.textContent = label;
        button.setAttribute("aria-pressed", String(tag === selectedPopularGenre));
        button.addEventListener("click", () => {
            getAlbums(tag);
        });
        popularGenreFilter.appendChild(button);
    });

    popularGenreWrap.appendChild(popularGenreFilter);
    albumGrid.before(popularGenreWrap);
}

function updatePopularGenreFilter() {
    popularGenreFilter?.querySelectorAll(".popular-genre-button").forEach((button, index) => {
        const isSelected = popularAlbumGenres[index].tag === selectedPopularGenre;
        button.classList.toggle("active", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
    });
}

async function getAlbums(genre = selectedPopularGenre) {
    previousView = "home";
    selectedPopularGenre = genre;
    const requestId = ++popularAlbumsRequestId;
    ensurePopularGenreFilter();
    popularGenreWrap.hidden = false;
    updatePopularGenreFilter();

    const recentRatingsSection = document.getElementById("recentRatingsSection");
    if (recentRatingsSection) recentRatingsSection.hidden = false;

    try {
        const page = Math.floor(Math.random() * 10) + 1;
        const data = await lastFm("tag.gettopalbums", {
            tag: genre,
            limit: 25,
            page
        });

        if (requestId !== popularAlbumsRequestId) return;

        albumGrid.replaceChildren();
        artistInfo.replaceChildren();
        topArtistsSection.hidden = false;

        const albums = data.albums?.album;

        if (!Array.isArray(albums)) {
            status.textContent = "Could not load albums.";
            return;
        }

        albums.forEach(album => {
            const artist = album.artist?.name || "Unknown artist";
            albumGrid.appendChild(
                createAlbumCard(album, artist, () => getAlbums())
            );
        });

        status.textContent = "";
    } catch (error) {
        if (requestId !== popularAlbumsRequestId) return;
        console.error(error);
        status.textContent = "Could not load albums.";
    }
}

function createAlbumCard(album, artistName, backAction) {
    const card = document.createElement("div");
    card.className = "album";

    const image = createImage(getImage(album.image), album.name);
    if (image) card.appendChild(image);

    const title = document.createElement("h2");
    title.textContent = album.name;

    const artist = document.createElement("p");
    artist.textContent = artistName;

    card.append(title, artist);

    card.addEventListener("click", () => {
        previousView = "albums";
        showAlbum(artistName, album.name, backAction);
    });

    return card;
}

function setSearchType(type) {
    const isArtist = type === "artist";
    searchType = type;
    artistToggle.classList.toggle("active", isArtist);
    albumToggle.classList.toggle("active", !isArtist);
    artistToggle.setAttribute("aria-pressed", String(isArtist));
    albumToggle.setAttribute("aria-pressed", String(!isArtist));
    searchToggle.classList.toggle("album-selected", !isArtist);
    searchInput.placeholder = isArtist
        ? "Search for an artist..."
        : "Search for an album...";
}

artistToggle.addEventListener("click", () => setSearchType("artist"));
albumToggle.addEventListener("click", () => setSearchType("album"));

function enableHorizontalScrolling(track) {
    track.addEventListener("dragstart", event => event.preventDefault());
    track.addEventListener("wheel", event => {
        if (event.deltaY === 0) return;

        const maxScrollLeft = track.scrollWidth - track.clientWidth;
        const canScrollInDirection = event.deltaY < 0
            ? track.scrollLeft > 0
            : track.scrollLeft < maxScrollLeft;
        if (!canScrollInDirection) return;

        event.preventDefault();
        track.scrollLeft += event.deltaY;
    }, { passive: false });

    let pointerId = null;
    let dragStartX = 0;
    let dragStartScrollLeft = 0;
    let didDrag = false;
    let suppressClick = false;
    let suppressClickTimer;

    const handlePointerMove = event => {
        if (event.pointerId !== pointerId) return;

        const deltaX = event.clientX - dragStartX;
        if (!didDrag && Math.abs(deltaX) < 5) return;

        didDrag = true;
        track.classList.add("is-dragging");
        track.scrollLeft = dragStartScrollLeft - deltaX;
        event.preventDefault();
    };

    const finishDrag = event => {
        if (event.pointerId !== pointerId) return;

        pointerId = null;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishDrag);
        window.removeEventListener("pointercancel", finishDrag);
        track.classList.remove("is-dragging");

        if (!didDrag) return;

        didDrag = false;
        suppressClick = true;
        window.clearTimeout(suppressClickTimer);
        suppressClickTimer = window.setTimeout(() => {
            suppressClick = false;
        }, 0);
    };

    track.addEventListener("pointerdown", event => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;

        pointerId = event.pointerId;
        dragStartX = event.clientX;
        dragStartScrollLeft = track.scrollLeft;
        didDrag = false;
        window.addEventListener("pointermove", handlePointerMove, { passive: false });
        window.addEventListener("pointerup", finishDrag);
        window.addEventListener("pointercancel", finishDrag);
    });

    track.addEventListener("click", event => {
        if (!suppressClick) return;

        suppressClick = false;
        window.clearTimeout(suppressClickTimer);
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

document.querySelectorAll(".carousel-track").forEach(enableHorizontalScrolling);

searchButton.addEventListener("click", search);

searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") search();
});

async function search() {
    const term = searchInput.value.trim();
    if (!term) return;

    if (popularGenreWrap) popularGenreWrap.hidden = true;
    previousSearch = term;
    albumGrid.replaceChildren();
    artistInfo.replaceChildren();
    topArtistsSection.hidden = true;

    if (searchType === "artist") {
        await showArtist(term);
    } else {
        await searchAlbum(term);
    }
}

async function showArtist(artistName) {
    if (popularGenreWrap) popularGenreWrap.hidden = true;
    const requestId = startLoading(`Loading ${artistName}...`);
    albumGrid.replaceChildren();
    artistInfo.replaceChildren();
    topArtistsSection.hidden = true;
    const recentRatingsSection = document.getElementById("recentRatingsSection");
    if (recentRatingsSection) recentRatingsSection.hidden = true;

    try {
        const data = await lastFm("artist.getinfo", {
            artist: artistName,
            autocorrect: 1
        });

        const artist = data.artist;

        if (!artist) {
            updateLoadingStatus(requestId, "Artist not found.");
            return;
        }

        const header = document.createElement("section");
        header.className = "artist-header";

        const imageURL = await getArtistImage(artist);
        const image = createImage(imageURL, `${artist.name} portrait`);

        if (image) header.appendChild(image);

        const title = document.createElement("h1");
        title.textContent = artist.name;
        header.appendChild(title);

        const bioText = (artist.bio?.summary || "")
            .replace(/<[^>]*>/g, "")
            .replace(/\s*Read more on Last\.fm.*$/i, "")
            .trim();

        if (bioText) {
            const bio = document.createElement("p");
            bio.className = "artist-bio";
            bio.textContent = bioText;
            header.appendChild(bio);
        }

        artistInfo.appendChild(header);

        const artistSearchURL =
            `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(`artist:"${artist.name}"`)}&limit=1&fmt=json`;

        const mbSearch = await musicBrainz(artistSearchURL);
        const mbArtist = mbSearch?.artists?.[0];

        if (mbArtist) {
            const mbURL =
                `https://musicbrainz.org/ws/2/artist/${mbArtist.id}?inc=genres&fmt=json`;

            const mbData = await musicBrainz(mbURL);

            if (mbData) {
                const metadata = document.createElement("div");
                metadata.className = "artist-metadata";

                [
                    createMetadataRow("Type", mbData.type),
                    createMetadataRow("Country", mbData.country),
                    createMetadataRow("Formed", mbData["life-span"]?.begin),
                    createMetadataRow("Ended", mbData["life-span"]?.end),
                    createMetadataRow("Genres", getGenres(mbData))
                ].filter(Boolean).forEach(row => metadata.appendChild(row));

                if (metadata.children.length) header.appendChild(metadata);
            }
        }

        updateLoadingStatus(requestId, `Loading albums by ${artist.name}...`);

        try {
            const albumData = await lastFm("artist.gettopalbums", {
                artist: artist.name,
                autocorrect: 1,
                limit: 25
            });

            const results = albumData.topalbums?.album;
            const albums = Array.isArray(results)
                ? results
                : results ? [results] : [];

            if (!albums.length) {
                updateLoadingStatus(requestId, `Information about ${artist.name}`);
                return;
            }

            albums.forEach(album => {
                albumGrid.appendChild(
                    createAlbumCard(album, artist.name, () => showArtist(artist.name))
                );
            });
        } catch (error) {
            console.warn("Artist information loaded, but albums failed:", error);
            updateLoadingStatus(requestId, `Information about ${artist.name}`);
        }
    } catch (error) {
        console.error(error);
        updateLoadingStatus(requestId, "Could not load artist information.");
    } finally {
        finishLoading(requestId);
    }
}

async function searchAlbum(term) {
    if (popularGenreWrap) popularGenreWrap.hidden = true;
    const requestId = startLoading(`Searching for ${term}...`);
    const recentRatingsSection = document.getElementById("recentRatingsSection");
    if (recentRatingsSection) recentRatingsSection.hidden = true;

    try {
        const data = await lastFm("album.search", {
            album: term,
            limit: 25
        });

        const results = data.results?.albummatches?.album;
        const albums = results
            ? Array.isArray(results) ? results : [results]
            : [];

        const normalizedTerm = String(term || "").trim().toLowerCase();
        const exact = albums.filter(album => {
            const name = String(album.name || "").trim().toLowerCase();
            if (name === normalizedTerm) return true;

            const words = normalizedTerm.split(/\s+/).filter(Boolean);
            for (let count = words.length; count >= 1; count -= 1) {
                const suffix = words.slice(-count).join(" ");
                if (name === suffix) {
                    return true;
                }
            }

            return false;
        });

        albumGrid.replaceChildren();
        artistInfo.replaceChildren();

        if (!exact.length) {
            updateLoadingStatus(requestId, `No exact album named "${term}" found.`);
            return;
        }

        updateLoadingStatus(requestId, `Albums named "${term}"`);

        exact.forEach(album => {
            albumGrid.appendChild(
                createAlbumCard(album, album.artist, () => searchAlbum(term))
            );
        });
    } catch (error) {
        console.error(error);
        updateLoadingStatus(requestId, "Could not search for albums.");
    } finally {
        finishLoading(requestId);
    }
}

async function showAlbum(artistName, albumName, backAction) {
    if (popularGenreWrap) popularGenreWrap.hidden = true;
    window.scrollTo(0, 0);
    document.documentElement.classList.add("album-loading");
    activeAlbumLoads += 1;
    const requestId = startLoading(`Loading ${albumName}...`);

    try {
        const data = await lastFm("album.getinfo", {
            artist: artistName,
            album: albumName,
            autocorrect: 1
        });

        const album = data.album;

        if (!album) {
            updateLoadingStatus(requestId, "Album not found.");
            return;
        }

        const releaseQuery =
            `releasegroup:"${album.name}" AND artist:"${artistName}"`;

        const releaseURL =
            `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(releaseQuery)}&limit=1&fmt=json`;

        const mbSearch = await musicBrainz(releaseURL);
        const mbRelease = mbSearch?.["release-groups"]?.[0];

        let mbAlbum = null;

        if (mbRelease) {
            mbAlbum = await musicBrainz(
                `https://musicbrainz.org/ws/2/release-group/${mbRelease.id}?inc=genres+tags&fmt=json`
            );
        }

        const labelQuery =
            `release:"${album.name}" AND artist:"${artistName}"`;

        const labelURL =
            `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(labelQuery)}&limit=1&inc=labels&fmt=json`;

        const labelData = await musicBrainz(labelURL);
        const labels = labelData?.releases?.[0]?.["label-info"]
            ?.map(item => item.label?.name)
            .filter(Boolean)
            .join(", ");

        const detail = document.createElement("section");
        detail.className = "album-detail";

        const albumView = document.createElement("div");
        albumView.className = "album-tracklist-view";
        detail.appendChild(albumView);

        const back = document.createElement("button");
        back.className = "back-button";
        back.textContent = "← Back";

        back.addEventListener("click", () => {
            if (backAction) {
                backAction();
            } else if (previousView === "artist") {
                showArtist(previousSearch);
            } else {
                getAlbums();
            }
        });

        albumView.appendChild(back);

        const header = document.createElement("div");
        header.className = "album-detail-header";

        const cover = document.createElement("div");
        cover.className = "album-cover-block";

        const image = createImage(getImage(album.image), album.name);
        if (image) cover.appendChild(image);

        const ratingKey = `album:${artistName}:${albumName}`;

        const albumRatingSummary = document.createElement("div");
        albumRatingSummary.className = "album-cover-rating";

        const albumRatingLabel = document.createElement("span");
        albumRatingLabel.className = "album-rating-meta-label";
        albumRatingLabel.textContent = "Album rating";

        const albumRatingValue = document.createElement("strong");
        albumRatingValue.className = "album-rating-meta-value";
        albumRatingValue.textContent = "Loading rating...";

        const storedRating = await getAlbumRating(ratingKey);
        albumRatingValue.textContent = formatAlbumRatingText(storedRating);

        albumRatingSummary.append(albumRatingLabel, albumRatingValue);
        header.appendChild(cover);

        const text = document.createElement("div");
        text.className = "album-detail-text";
        text.appendChild(albumRatingSummary);

        const title = document.createElement("h2");
        title.textContent = album.name;

        const artist = document.createElement("p");
        artist.textContent = album.artist || artistName;

        text.append(title, artist);

        if (mbAlbum) {
            const metadata = document.createElement("div");
            metadata.className = "album-metadata";

            [
                createMetadataRow("Type", mbAlbum["primary-type"]),
                createMetadataRow("Additional type", mbAlbum["secondary-types"]?.join(", ")),
                createMetadataRow("Released", mbAlbum["first-release-date"]),
                createMetadataRow("Genres", getGenres(mbAlbum)),
                createMetadataRow("Tags", mbAlbum.tags?.slice(0, 8).map(tag => tag.name).join(", ")),
                createMetadataRow("Label", labels)
            ].filter(Boolean).forEach(row => metadata.appendChild(row));

            if (metadata.children.length) text.appendChild(metadata);
        } else {
            const labelRow = createMetadataRow("Label", labels);
            if (labelRow) text.appendChild(labelRow);
        }

        if (album.wiki?.summary) {
            const summary = document.createElement("p");
            summary.className = "album-summary";
            summary.textContent = album.wiki.summary.replace(/<[^>]*>/g, "");
            text.appendChild(summary);
        }

        header.appendChild(text);
        albumView.appendChild(header);

        const rawTracks = album.tracks?.track;
        const tracks = Array.isArray(rawTracks)
            ? rawTracks
            : rawTracks ? [rawTracks] : [];

        if (tracks.length) {
            const filter = document.createElement("div");
            filter.className = "track-filter";

            const label = document.createElement("label");
            label.htmlFor = "trackSort";
            label.textContent = "Sort by:";

            const select = document.createElement("select");
            select.id = "trackSort";

            [
                ["order", "Album order"],
                ["popular", "Most popular"],
                ["least", "Least popular"]
            ].forEach(([value, name]) => {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = name;
                select.appendChild(option);
            });

            select.value = "order";
            filter.append(label, select);

            const list = document.createElement("ol");
            list.className = "track-list";
            let ratingScreen;

            const trackQueue = document.createElement("div");
            trackQueue.className = "track-queue";
            trackQueue.appendChild(list);

            updateLoadingStatus(requestId, "Loading track popularity...");

            const trackData = await Promise.all(tracks.map(async (track, index) => {
                const name = typeof track === "string" ? track : track.name;
                let playcount = 0;
                let duration = getDurationMs(
                    typeof track === "object" ? track.duration : 0
                );

                try {
                    const info = await lastFm("track.getInfo", {
                        artist: artistName,
                        track: name,
                        autocorrect: 1
                    });

                    playcount = Number(info.track?.playcount || 0);
                    duration = getDurationMs(info.track?.duration) || duration;
                } catch (error) {
                    console.warn("Track popularity unavailable:", error);
                }

                return {
                    name,
                    duration,
                    playcount,
                    index
                };
            }));

            function highlightCurrentTrack(index) {
                const session = albumRatingSessions.get(ratingKey);
                let activeItem = null;

                list.querySelectorAll(".track-item").forEach(item => {
                    const itemIndex = Number(item.dataset.trackIndex);
                    item.classList.toggle("active", itemIndex === index);
                    const rating = session?.ratings[itemIndex] ?? null;
                    item.classList.toggle("rated", rating !== null);
                    item.querySelector(".track-rating").textContent = rating
                        ? "★".repeat(rating)
                        : "";
                    if (itemIndex === index) activeItem = item;
                });

                if (activeItem) {
                    list.scrollTo({
                        top: activeItem.offsetTop,
                        behavior: "smooth"
                    });
                }
            }

            function renderTracks() {
                list.replaceChildren();

                const sorted = [...trackData];

                if (select.value === "popular") {
                    sorted.sort((a, b) => b.playcount - a.playcount);
                } else if (select.value === "least") {
                    sorted.sort((a, b) => a.playcount - b.playcount);
                } else {
                    sorted.sort((a, b) => a.index - b.index);
                }

                sorted.forEach(track => {
                    const item = document.createElement("li");
                    item.className = "track-item";
                    item.dataset.trackIndex = String(track.index);

                    const name = document.createElement("span");
                    name.className = "track-name";
                    name.textContent = track.name;

                    const number = document.createElement("span");
                    number.className = "track-number";
                    number.textContent = String(track.index + 1).padStart(2, "0");

                    item.append(number, name);

                    const rating = albumRatingSessions.get(ratingKey)?.ratings[track.index] ?? null;
                    const ratingText = document.createElement("span");
                    ratingText.className = "track-rating";
                    ratingText.textContent = rating ? "★".repeat(rating) : "";
                    item.classList.toggle("rated", rating !== null);
                    item.appendChild(ratingText);

                    if (track.duration > 0) {
                        const duration = document.createElement("span");
                        duration.className = "track-duration";

                        const seconds = Math.floor(track.duration / 1000);
                        duration.textContent =
                            `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

                        item.appendChild(duration);
                    }

                    item.addEventListener("click", () => {
                        if (!ratingScreen || ratingScreen.hidden) return;

                        const nextIndex = Number(item.dataset.trackIndex);
                        if (albumRatingPanel?.setTrackIndex) {
                            albumRatingPanel.setTrackIndex(nextIndex);
                        }
                    });

                    const session = albumRatingSessions.get(`album:${artistName}:${albumName}`);
                    item.classList.toggle("active", session && Number(item.dataset.trackIndex) === session.index);
                    list.appendChild(item);
                });

                const spacer = document.createElement("li");
                spacer.className = "track-list-spacer";
                spacer.setAttribute("aria-hidden", "true");
                spacer.style.height = "520px";
                list.appendChild(spacer);
            }

            select.addEventListener("change", () => {
                renderTracks();
                highlightCurrentTrack(albumRatingSessions.get(ratingKey)?.index ?? 0);
            });

            const albumRatingPanel = createAlbumRatingPanel({
                key: ratingKey,
                tracks: trackData,
                summaryEl: albumRatingValue,
                highlightCurrentTrack
            });
            albumRatingPanel.classList.add("album-rating-session");

            ratingScreen = document.createElement("div");
            ratingScreen.className = "album-rating-screen";
            ratingScreen.hidden = true;

            const backToTracksButton = document.createElement("button");
            backToTracksButton.type = "button";
            backToTracksButton.className = "back-button";
            backToTracksButton.textContent = "← Back to album tracks";

            const ratingHeader = document.createElement("div");
            ratingHeader.className = "album-rating-header";

            const ratingArtwork = createImage(getImage(album.image), album.name);

            const ratingIdentity = document.createElement("div");
            const ratingAlbumTitle = document.createElement("h2");
            ratingAlbumTitle.className = "album-rating-album-title";
            ratingAlbumTitle.textContent = album.name;

            const ratingArtistName = document.createElement("p");
            ratingArtistName.className = "album-rating-artist";
            ratingArtistName.textContent = album.artist || artistName;

            ratingIdentity.append(ratingAlbumTitle, ratingArtistName);
            ratingHeader.append(ratingArtwork, ratingIdentity);

            const ratingLayout = document.createElement("div");
            ratingLayout.className = "album-rating-layout";
            ratingLayout.appendChild(albumRatingPanel);
            ratingScreen.append(backToTracksButton, ratingHeader, ratingLayout);
            detail.appendChild(ratingScreen);

            const rateTracksButton = document.createElement("button");
            rateTracksButton.type = "button";
            rateTracksButton.className = "album-rating-button album-rate-tracks";
            rateTracksButton.textContent = "Rate this album";

            const albumActions = document.createElement("div");
            albumActions.className = "album-actions";
            albumActions.append(filter, rateTracksButton);

            albumView.append(albumActions, trackQueue);
            renderTracks();

            rateTracksButton.addEventListener("click", () => {
                ratingLayout.appendChild(trackQueue);
                albumView.hidden = true;
                ratingScreen.hidden = false;
                highlightCurrentTrack(albumRatingSessions.get(ratingKey)?.index ?? 0);
                window.scrollTo({ top: 0, behavior: "smooth" });
            });

            backToTracksButton.addEventListener("click", () => {
                albumView.insertBefore(trackQueue, albumActions.nextSibling);
                ratingScreen.hidden = true;
                albumView.hidden = false;
                highlightCurrentTrack(albumRatingSessions.get(ratingKey)?.index ?? 0);
                list.scrollIntoView({ block: "start", behavior: "smooth" });
            });
        }

        albumGrid.replaceChildren();
        artistInfo.replaceChildren();
        topArtistsSection.hidden = true;
        const recentRatingsSection = document.getElementById("recentRatingsSection");
        if (recentRatingsSection) recentRatingsSection.hidden = true;
        albumGrid.appendChild(detail);
        const trackList = detail.querySelector(".track-list");
        const session = albumRatingSessions.get(`album:${artistName}:${albumName}`);
        if (trackList && session) {
            const activeTrack = trackList.querySelector(
                `.track-item[data-track-index="${session.index}"]`
            );
            if (activeTrack) {
                trackList.scrollTo({ top: activeTrack.offsetTop, behavior: "smooth" });
            }
        }
        updateLoadingStatus(requestId, `${album.name} by ${album.artist || artistName}`);
    } catch (error) {
        console.error(error);
        updateLoadingStatus(requestId, "Could not load album information.");
    } finally {
        finishLoading(requestId);
        activeAlbumLoads -= 1;
        if (activeAlbumLoads === 0) {
            document.documentElement.classList.remove("album-loading");
        }
    }
}

getRecentRatings();
getTopArtists();
getAlbums();