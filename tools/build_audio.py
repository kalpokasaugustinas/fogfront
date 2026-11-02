# converts downloaded music + sound effect files into the small web files in audio/.
# usage: python tools/build_audio.py <music_dir> <sfx_dir>
#   music_dir: the downloaded tracks (names as in the music table below)
#   sfx_dir:   unzipped kenney packs (rpg-audio, impact-sounds, interface-sounds) + opengameart files
# needs ffmpeg: pip install imageio-ffmpeg
# licences and authors of every source file are listed in audio/CREDITS.md.

import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

ff = imageio_ffmpeg.get_ffmpeg_exe()
out = Path(__file__).resolve().parent.parent / 'audio'

# music: (output name, source file, start s, end s or none). loudness-matched to -16 lufs, 128 kbps mp3
music = [
    ('menu-aphelion', 'menu-3 Buckley - Aphelion.mp3', 105, 285),           # skip the calm intro, 3 min loop
    ('game-forge', 'game-1 Buckley - Song Of The Forge.mp3', 0, 107.25),    # opening march only
    ('game-five-armies', 'game-10 MacLeod - Five Armies.mp3', 0, None),
    ('game-heroic-demise', 'game-6 Matthew Pablo - Heroic Demise.mp3', 0, 150),  # first 2.5 min, keeps the file small
    ('game-battle-theme-a', 'game-5 Cynicmusic - Battle Theme A.mp3', 0, None),
    ('victory', 'victory-1 RPG Orchestral - Precipice of Victory.mp3', 0, None),
    ('defeat', 'defeat-1 RPG Orchestral - The Fallen.mp3', 0, None),
]

# sound effects: (output name, source file, start s, length s or none). mono 96 kbps
sfx = [
    ('click', 'interface-sounds/Audio/click_001.ogg', 0, None),
    *[(f'step{i}', f'impact-sounds/Audio/footstep_grass_00{i}.ogg', 0, None) for i in range(3)],
    *[(f'build{i}', f'impact-sounds/Audio/impactPlank_medium_00{i}.ogg', 0, None) for i in range(3)],
    *[(f'clash{i}', f'swords/clash/sword_clash.{i + 1}.ogg', 0, None) for i in range(10)],
    # war cries: short slices of a crowd shouting ambience
    *[(f'shout{i}', 'crowd_shouting.ogg', 0.4 + i * 5, 1.6) for i in range(5)],
    ('drums', 'horde_war_drums_by_william_hector.wav', 0, 3.6),             # 3-2-1 countdown bed
]


def run(args):
    # run ffmpeg quietly, stop on the first error
    subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)


def build_music(src_dir):
    for name, src, start, end in music:
        trim = ['-ss', str(start)] + (['-to', str(end)] if end else [])
        # short fades so cut points never click; the player crossfades between files anyway
        af = 'loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.5'
        run([*trim, '-i', str(src_dir / src), '-af', af, '-map', '0:a', '-map_metadata', '-1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', str(out / 'music' / f'{name}.mp3')])


def build_sfx(src_dir):
    for name, src, start, length in sfx:
        trim = ['-ss', str(start)] + (['-t', str(length)] if length else [])
        af = 'anull'   # no normalizing: clips are too short for it, levels are set in js/audio.js
        if length:
            af += f',afade=t=in:d=0.08,afade=t=out:st={length - 0.4}:d=0.4'
        run([*trim, '-i', str(src_dir / src), '-af', af, '-map', '0:a', '-map_metadata', '-1', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', str(out / 'sfx' / f'{name}.mp3')])


if __name__ == '__main__':
    (out / 'music').mkdir(parents=True, exist_ok=True)
    (out / 'sfx').mkdir(parents=True, exist_ok=True)
    build_music(Path(sys.argv[1]))
    build_sfx(Path(sys.argv[2]))
    for f in sorted(out.rglob('*.mp3')):
        print(f'{f.stat().st_size / 1e6:6.2f} MB  {f.relative_to(out)}')
