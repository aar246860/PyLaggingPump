
import numpy as np

def drawdown_time_domain(t, T, S, r, Q):
    t = np.asarray(t, dtype=float) + 1e-9
    return (Q/(4*np.pi*T)) * np.sqrt(np.log(1 + (r*r*S)/(4*T*t)))
