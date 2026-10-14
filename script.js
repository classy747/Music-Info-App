const imagePlaceholder = "img/placeholder.png";

const albumGrid = document.getElementById("albumGrid");
const carouselTrack = document.getElementById("carouselTrack");
const topArtistsSection = document.getElementById("topArtistsSection");
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const artistToggle = document.getElementById("artistToggle");
const albumToggle = document.getElementById("albumToggle");
const artistInfo = document.getElementById("artistInfo");
const status = document.getElementById("status");

let searchType = "artist";
let previousView = "home";
let previousSearch = "";

async function lastFm(method, params = {}) {
    const query = new URLSearchParams({ method, ...params });
    const response = await fetch(`/api/lastfm?${query}`);

    if (!response.ok) {
        throw new Error(`Last.fm request failed: ${response.status}`);
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
    image.alt = alt;
    image.loading = "lazy";
    image.addEventListener("error", () => {
        image.src = imagePlaceholder;
    }, { once: true });
    image.src = url || imagePlaceholder;

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
                searchType = "artist";
                artistToggle.classList.add("active");
                albumToggle.classList.remove("active");
                showArtist(artist.name);
            });

            return card;
        }));

        carouselTrack.append(...cards);
    } catch (error) {
        console.error(error);
    }
}

async function getAlbums() {
    previousView = "home";

    try {
        const page = Math.floor(Math.random() * 10) + 1;
        const data = await lastFm("tag.gettopalbums", {
            tag: "rock",
            limit: 25,
            page
        });

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

artistToggle.addEventListener("click", () => {
    searchType = "artist";
    artistToggle.classList.add("active");
    albumToggle.classList.remove("active");
    searchInput.placeholder = "Search for an artist...";
});

albumToggle.addEventListener("click", () => {
    searchType = "album";
    albumToggle.classList.add("active");
    artistToggle.classList.remove("active");
    searchInput.placeholder = "Search for an album...";
});

searchButton.addEventListener("click", search);

searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") search();
});

async function search() {
    const term = searchInput.value.trim();
    if (!term) return;

    previousSearch = term;
    albumGrid.replaceChildren();
    artistInfo.replaceChildren();
    topArtistsSection.hidden = true;
    status.textContent = "Searching...";

    if (searchType === "artist") {
        await showArtist(term);
    } else {
        await searchAlbum(term);
    }
}

async function showArtist(artistName) {
    albumGrid.replaceChildren();
    artistInfo.replaceChildren();
    topArtistsSection.hidden = true;
    status.textContent = `Loading ${artistName}...`;

    try {
        const data = await lastFm("artist.getinfo", {
            artist: artistName,
            autocorrect: 1
        });

        const artist = data.artist;

        if (!artist) {
            status.textContent = "Artist not found.";
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

        status.textContent = `Albums by ${artist.name}`;

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
                status.textContent = `Information about ${artist.name}`;
                return;
            }

            albums.forEach(album => {
                albumGrid.appendChild(
                    createAlbumCard(album, artist.name, () => showArtist(artist.name))
                );
            });
        } catch (error) {
            console.warn("Artist information loaded, but albums failed:", error);
            status.textContent = `Information about ${artist.name}`;
        }
    } catch (error) {
        console.error(error);
        status.textContent = "Could not load artist information.";
    }
}

async function searchAlbum(term) {
    try {
        const data = await lastFm("album.search", {
            album: term,
            limit: 25
        });

        const results = data.results?.albummatches?.album;
        const albums = results
            ? Array.isArray(results) ? results : [results]
            : [];

        const exact = albums.filter(album =>
            album.name?.toLowerCase() === term.toLowerCase()
        );

        albumGrid.replaceChildren();
        artistInfo.replaceChildren();

        if (!exact.length) {
            status.textContent = `No exact album named "${term}" found.`;
            return;
        }

        status.textContent = `Albums named "${term}"`;

        exact.forEach(album => {
            albumGrid.appendChild(
                createAlbumCard(album, album.artist, () => searchAlbum(term))
            );
        });
    } catch (error) {
        console.error(error);
        status.textContent = "Could not search for albums.";
    }
}

async function showAlbum(artistName, albumName, backAction) {
    albumGrid.replaceChildren();
    artistInfo.replaceChildren();
    topArtistsSection.hidden = true;
    status.textContent = `Loading ${albumName}...`;

    try {
        const data = await lastFm("album.getinfo", {
            artist: artistName,
            album: albumName,
            autocorrect: 1
        });

        const album = data.album;

        if (!album) {
            status.textContent = "Album not found.";
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

        detail.appendChild(back);

        const header = document.createElement("div");
        header.className = "album-detail-header";

        const image = createImage(getImage(album.image), album.name);
        if (image) header.appendChild(image);

        const text = document.createElement("div");
        text.className = "album-detail-text";

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
        detail.appendChild(header);

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

            select.value = "popular";
            filter.append(label, select);
            detail.appendChild(filter);

            const list = document.createElement("ol");
            list.className = "track-list";
            detail.appendChild(list);

            status.textContent = "Loading track popularity...";

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

                    const name = document.createElement("span");
                    name.className = "track-name";
                    name.textContent = track.name;
                    item.appendChild(name);

                    if (track.duration > 0) {
                        const duration = document.createElement("span");
                        duration.className = "track-duration";

                        const seconds = Math.floor(track.duration / 1000);
                        duration.textContent =
                            `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

                        item.appendChild(duration);
                    }

                    list.appendChild(item);
                });
            }

            select.addEventListener("change", renderTracks);
            renderTracks();
        }

        albumGrid.appendChild(detail);
        status.textContent = `${album.name} by ${album.artist || artistName}`;
    } catch (error) {
        console.error(error);
        status.textContent = "Could not load album information.";
    }
}

getTopArtists();
getAlbums();