---
name: ffmpeg-media
description: "Convert, trim, merge, compress, and extract from audio/video files with ffmpeg — format conversion, clips, audio extraction, GIFs, thumbnails, volume changes, batch processing. Use for any task that touches a media file with a job to do on it."
---

## Read a file first
- Always `ffprobe -hide_banner <file>` (or `ffmpeg -i <file>`) BEFORE acting — report real duration, codecs, resolution, streams. Cutting or transcoding blind produces wrong outputs.
- Default output location: the user's workspace documents area (`/home/dominic/Warden/`) unless the task names a path.

## Common jobs
- Convert container/codec: `ffmpeg -i in.mp4 -c:v libx264 -crf 20 -c:a aac out.mp4` (CRF 18–23; higher = smaller).
- Trim a clip (stream copy, instant, keyframe-accurate enough for most asks): `ffmpeg -ss 00:01:30 -to 00:02:15 -i in.mp4 -c copy out.mp4`. Re-encode (exact cut) by putting `-ss` AFTER `-i` and dropping `-c copy`.
- Extract audio: `ffmpeg -i in.mp4 -vn -c:a libmp3lame -q:a 2 out.mp3` (or `-c:a copy` when the stream is already the wanted codec).
- GIF from a clip: `ffmpeg -ss <start> -t <secs> -i in.mp4 -vf "fps=12,scale=480:-1:flags=lanczos" out.gif`.
- Thumbnail/preview frame: `ffmpeg -ss 00:00:05 -i in.mp4 -frames:v 1 out.jpg`.
- Volume: `ffmpeg -i in.mp3 -af "volume=1.5" out.mp3`. Normalize loudness: `-af loudnorm`.
- Merge files (same codecs): concat demuxer — write a `list.txt` of `file '...'` lines, then `ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4`.
- Strip audio from video: `ffmpeg -i in.mp4 -an -c:v copy out.mp4`.
- Batch a folder: one `Bash` call with a `for f in *.mp4; do ffmpeg ... "$f" "out/${f%.mp4}.mkv"; done` — one process at a time, not parallel per-file.
- Crop/scale/rotate: `-vf scale=1280:-2` (even dimensions for h264), `crop=w:h:x:y`, `transpose=1`.

## Rules
- Quote the ffprobe facts (duration, streams) in the reply when reporting what a job did.
- `-c copy` jobs finish in seconds; if a copy-based trim lands on the wrong keyframe, re-encode instead of retrying the same command.
- Verify the output exists with its size (`ls -lh out`) before calling the job done.
- Long transcodes (multi-minute, large files) belong in a background atlas job, not a chat turn.