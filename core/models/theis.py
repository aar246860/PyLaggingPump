
"""Theis model placeholder.

s(t) = (Q / (4*pi*T)) * W(u), u = r^2 * S / (4*T*t)
For MVP we return a simple proxy; replace with scipy.special.expn for exact well function.
"""
import numpy as np

def drawdown_time_domain(t, T, S, r, Q):
    t = np.asarray(t, dtype=float) + 1e-9
    return (Q/(4*np.pi*T)) * np.log(1 + (r*r*S)/(4*T*t))
