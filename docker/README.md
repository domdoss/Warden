# Docker deployment (optional)

This directory packages the Warden stack into three containerized roles:

| Image | Role | Notes |
|---|---|---|
| `warden` | Brain / dashboard / settings store | Always runs. |
| `video` | Security detector + frame server (port 8765) | Needs `/dev/video0` and a CUDA GPU. |
| `audio` | Hologram voice client (STT/TTS/UI) | **Best run bare metal.** Containerized Audio is provided for completeness but needs display/audio passthrough. |

The **Satellite** (Pi mic/speaker relay) is intentionally **not** containerized — it runs bare metal on the Pi.

## Quick start — single Docker host

```bash
cd docker

# Build images from the current checkout.
./build.sh

# Start Warden + Video.
docker compose up -d
```

Then open http://localhost:3200.

## Multi-host / mixed LAN setup

Edit a `.env` file next to `docker-compose.yml`:

```dotenv
# Where Warden lives (used by Video to reach it).
WARDEN_URL=http://192.168.0.10:3200

# Where Video lives (used by Warden to pull frames).
VIDEO_URL=http://192.168.0.11:8765

# Ollama on a third box with a GPU.
OLLAMA_URL=http://192.168.0.12:11434

# If the Pi is the Satellite, point Audio at it.
SATELLITE_URL=http://192.168.0.20:8766
```

Run roles independently on their hosts:

```bash
# GPU box with Video only
WARDEN_URL=http://192.168.0.10:3200 docker compose up video -d

# Small box / Pi with Warden only
VIDEO_URL=http://192.168.0.11:8765 docker compose up warden -d

# Laptop with Audio (bare metal recommended, but container example)
docker compose -f docker-compose.yml -f compose.audio.yml up audio -d
```

## Building from a specific git ref

```bash
./build.sh v1.3.0
```

## Important notes

- **Audio:** the hologram is a GUI app. In a container it needs X11 + PulseAudio/ALSA forwarding. For normal use, run `voice/main.py` directly on the laptop.
- **GPU:** `video` and `audio` images use the NVIDIA CUDA runtime. Make sure the host has the NVIDIA Container Toolkit installed and `nvidia` set as the default Docker runtime.
- **Data:** Warden state lives in named volumes (`warden-data`, `warden-store`, `warden-groups`, `warden-logs`). Back them up with `docker volume` commands.
- **Configuration:** role URLs are configured via environment variables. After the distributed-roles settings-store refactor lands, the same values can also be edited in the dashboard and will take precedence unless the env var is set.
