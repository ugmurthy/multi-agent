import json
import random
from collections import defaultdict
import math

# Input data
input_data = {
    "current_standings": {
        "PBKS": {"played": 5, "won": 4, "lost": 0, "nr": 1, "points": 9, "nrr": 1.067},
        "RCB": {"played": 5, "won": 4, "lost": 1, "nr": 0, "points": 8, "nrr": 1.503},
        "RR": {"played": 5, "won": 4, "lost": 1, "nr": 0, "points": 8, "nrr": 0.889},
        "GT": {"played": 5, "won": 3, "lost": 2, "nr": 0, "points": 6, "nrr": 0.018},
        "SRH": {"played": 5, "won": 2, "lost": 3, "nr": 0, "points": 4, "nrr": 0.576},
        "DC": {"played": 4, "won": 2, "lost": 2, "nr": 0, "points": 4, "nrr": 0.322},
        "LSG": {"played": 5, "won": 2, "lost": 3, "nr": 0, "points": 4, "nrr": -0.804},
        "CSK": {"played": 5, "won": 2, "lost": 3, "nr": 0, "points": 4, "nrr": -0.846},
        "MI": {"played": 5, "won": 1, "lost": 4, "nr": 0, "points": 2, "nrr": -1.076},
        "KKR": {"played": 5, "won": 0, "lost": 5, "nr": 1, "points": 1, "nrr": -1.149}
    },
    "team_ratings": {
        "PBKS": 0.70, "RCB": 0.72, "RR": 0.68, "GT": 0.55, "SRH": 0.52,
        "DC": 0.50, "LSG": 0.48, "CSK": 0.45, "MI": 0.40, "KKR": 0.33
    },
    "matches_per_team": 14,
    "iterations": 10000
}

standings = input_data["current_standings"]
ratings = input_data["team_ratings"]
matches_per_team = input_data["matches_per_team"]
iterations = input_data["iterations"]

teams = list(standings.keys())
print(f"Teams: {teams}")
print(f"Number of teams: {len(teams)}")

# Calculate remaining matches per team
remaining_matches = {}
for team in teams:
    played = standings[team]["played"] + standings[team]["nr"]  # NR counts as played
    remaining = matches_per_team - played
    remaining_matches[team] = remaining
    print(f"{team}: played={played}, remaining={remaining}")
