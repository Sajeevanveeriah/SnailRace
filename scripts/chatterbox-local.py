"""Record commentary takes with Chatterbox on this machine (CPU is fine, about 15 s a take).
Normally run for you by `generate-commentary.mjs --local`; see public/audio/README.md.
usage: python chatterbox-local.py jobs.json voice_prompt out_dir [limit]
Writes <out_dir>/<cue>-<take>.wav; skips any that already exist. Same parameters
as the hosted space call: exaggeration per cue, cfg 0.35, temperature 0.8, fixed seed."""
import json, os, sys, time, random
import numpy as np, torch, torchaudio
from chatterbox.tts import ChatterboxTTS

jobs = json.load(open(sys.argv[1]))
prompt, out = sys.argv[2], sys.argv[3]
limit = int(sys.argv[4]) if len(sys.argv) > 4 else len(jobs)
os.makedirs(out, exist_ok=True)
torch.set_num_threads(os.cpu_count() or 4)
t0 = time.time()
model = ChatterboxTTS.from_pretrained(device="cpu")
print(f"model loaded in {time.time()-t0:.0f}s", flush=True)
done = 0
for job in jobs:
    if done >= limit: break
    path = os.path.join(out, f"{job['cue']}-{job['take']}.wav")
    if os.path.exists(path): continue
    seed = job["seed"]
    torch.manual_seed(seed); random.seed(seed); np.random.seed(seed)
    t = time.time()
    wav = model.generate(job["text"], audio_prompt_path=prompt, exaggeration=job["exaggeration"], cfg_weight=0.35, temperature=0.8)
    torchaudio.save(path + ".part.wav", wav, model.sr)
    os.replace(path + ".part.wav", path)
    done += 1
    print(f"{job['file']} {time.time()-t:.0f}s {wav.shape[-1]/model.sr:.1f}s audio", flush=True)
print("finished", done, flush=True)
