from heybuddy.dataset.augmented import *
from heybuddy.dataset.features import *
from heybuddy.dataset.generator import *
# NIGHTJAR PATCH: the piper import is guarded. Its chain (dataset.piper ->
# piper.pretrained) raises ImportError at import time when piper-phonemize is not
# installed — which on a Nightjar training box is DELIBERATE (the GPL espeak-ng
# wrapper heading the NJ-59 lessac lineage is left uninstalled). Without this
# guard, `heybuddy train` imported this package before --positive-audio-dir could
# select WAV injection, so the lazy-import patch was defeated at the package
# boundary (Bugbot, PR #155). With the guard, the Piper path still raises — but
# at the point of USE (features.get_tts_generator), with piper's own actionable
# install message, and only when no audio dir was given.
try:
    from heybuddy.dataset.piper import *
except ImportError:
    pass
from heybuddy.dataset.precalculated import *
from heybuddy.dataset.training import *
from heybuddy.dataset.wav_directory import *  # NIGHTJAR PATCH
