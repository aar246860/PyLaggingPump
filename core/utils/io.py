
import csv
from typing import List, Tuple

def read_csv_simple(path) -> List[Tuple[float,float]]:
    data = []
    with open(path, newline="") as f:
        rdr = csv.DictReader(f)
        for row in rdr:
            t = float(row.get("time_min", "0"))
            s = float(row.get("drawdown_m", "0"))
            data.append((t,s))
    return data
