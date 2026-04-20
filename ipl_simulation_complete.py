import json
import random
from collections import defaultdict
import math

# Set seed for reproducibility
random.seed(42)

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
print("=" * 80)
print("IPL 2026 PLAYOFF PREDICTION - MONTE CARLO SIMULATION")
print("=" * 80)
print(f"\nCurrent Standings as of April 18, 2026:")
print("-" * 80)

# Display current standings
for team in teams:
    s = standings[team]
    print(f"{team:5s}: P{s['played'] + s['nr']:2d} W{s['won']:2d} L{s['lost']:2d} NR{s['nr']:1d} | Points: {s['points']:2d} | NRR: {s['nrr']:+.3f}")

print("\n" + "=" * 80)
print("SIMULATION PARAMETERS")
print("=" * 80)
print(f"Total matches per team: {matches_per_team}")
print(f"Number of iterations: {iterations}")
print(f"Teams in tournament: {len(teams)}")
print(f"Playoff spots available: 4")

# Calculate remaining matches per team
remaining_matches = {}
total_remaining = 0
for team in teams:
    played = standings[team]["played"] + standings[team]["nr"]
    remaining = matches_per_team - played
    remaining_matches[team] = remaining
    total_remaining += remaining
    print(f"{team}: {remaining} matches remaining")

print(f"\nTotal remaining matches to simulate: {total_remaining // 2}")

# Generate remaining fixtures (each team plays every other team twice)
def generate_remaining_fixtures():
    """Generate all remaining fixtures based on current standings"""
    fixtures = []
    
    # Track how many times each pair has played
    played_count = defaultdict(int)
    
    # Count existing matches from standings
    # Each team should play 14 matches total (2 vs each of 9 opponents = 18, but IPL format varies)
    # For simplicity, assume double round-robin
    
    # Build fixture list - each pair plays twice
    for i, team1 in enumerate(teams):
        for team2 in teams[i+1:]:
            # Each pair plays twice
            fixtures.append((team1, team2))
            fixtures.append((team2, team1))
    
    return fixtures

all_fixtures = generate_remaining_fixtures()
print(f"\nTotal fixtures in season: {len(all_fixtures)}")

# Function to calculate win probability based on ratings
def get_win_probability(team1, team2):
    """Calculate win probability using Bradley-Terry model with adjustments"""
    r1 = ratings[team1]
    r2 = ratings[team2]
    
    # Bradley-Terry model: P(team1 wins) = r1 / (r1 + r2)
    base_prob = r1 / (r1 + r2)
    
    # Add some randomness/variance (home advantage, form, etc.)
    variance = 0.05  # 5% variance
    adjusted_prob = max(0.1, min(0.9, base_prob + random.uniform(-variance, variance)))
    
    return adjusted_prob

# Function to simulate a single match
def simulate_match(team1, team2):
    """Simulate a match and return winner"""
    prob = get_win_probability(team1, team2)
    if random.random() < prob:
        return team1
    else:
        return team2

# Function to simulate NRR change after a match
def simulate_nrr_change(winner, loser):
    """Simulate NRR change based on match result"""
    # Winner gains NRR, loser loses NRR
    # Typical NRR swing is around 0.2-0.4 per match
    nrr_gain = random.uniform(0.15, 0.35)
    return nrr_gain, -nrr_gain

# Main simulation function
def run_simulation(iterations):
    playoff_counts = defaultdict(int)
    championship_counts = defaultdict(int)
    points_distribution = defaultdict(list)
    
    for iteration in range(iterations):
        # Initialize standings for this iteration
        sim_standings = {}
        for team in teams:
            sim_standings[team] = {
                'points': standings[team]['points'],
                'won': standings[team]['won'],
                'lost': standings[team]['lost'],
                'nr': standings[team]['nr'],
                'played': standings[team]['played'],
                'nrr': standings[team]['nrr']
            }
        
        # Simulate remaining matches
        # We need to figure out which matches are already played
        
        # Simplified approach: simulate matches until each team reaches 14 games
        matches_to_simulate = []
        
        # Create a matrix to track matches between teams
        match_matrix = defaultdict(lambda: defaultdict(int))
        
        # Estimate already played matches (this is approximate)
        # In reality, we'd need the actual fixture list
        for team in teams:
            played = standings[team]['played'] + standings[team]['nr']
            # Distribute played matches among opponents
            opponents = [t for t in teams if t != team]
            for _ in range(played):
                opp = random.choice(opponents)
                match_matrix[team][opp] += 1
        
        # Generate remaining matches
        for team1 in teams:
            for team2 in teams:
                if team1 < team2:  # Avoid duplicates
                    already_played = min(match_matrix[team1][team2], match_matrix[team2][team1])
                    # Each pair plays twice
                    remaining = 2 - already_played
                    for _ in range(max(0, remaining)):
                        matches_to_simulate.append((team1, team2))
        
        # Shuffle matches to randomize order
        random.shuffle(matches_to_simulate)
        
        # Simulate each match
        for team1, team2 in matches_to_simulate:
            # Check if both teams still have matches to play
            p1 = sim_standings[team1]['played'] + sim_standings[team1]['nr']
            p2 = sim_standings[team2]['played'] + sim_standings[team2]['nr']
            
            if p1 >= matches_per_team or p2 >= matches_per_team:
                continue
            
            # Simulate the match
            winner = simulate_match(team1, team2)
            
            # Update standings
            if winner == team1:
                sim_standings[team1]['won'] += 1
                sim_standings[team1]['points'] += 2
                sim_standings[team1]['played'] += 1
                
                sim_standings[team2]['lost'] += 1
                sim_standings[team2]['played'] += 1
                
                nrr_gain, nrr_loss = simulate_nrr_change(team1, team2)
                sim_standings[team1]['nrr'] += nrr_gain
                sim_standings[team2]['nrr'] += nrr_loss
            else:
                sim_standings[team2]['won'] += 1
                sim_standings[team2]['points'] += 2
                sim_standings[team2]['played'] += 1
                
                sim_standings[team1]['lost'] += 1
                sim_standings[team1]['played'] += 1
                
                nrr_gain, nrr_loss = simulate_nrr_change(team2, team1)
                sim_standings[team2]['nrr'] += nrr_gain
                sim_standings[team1]['nrr'] += nrr_loss
        
        # Determine playoff qualifiers (top 4 by points, then NRR)
        sorted_teams = sorted(sim_standings.items(), 
                             key=lambda x: (x[1]['points'], x[1]['nrr']), 
                             reverse=True)
        
        playoff_teams = [t[0] for t in sorted_teams[:4]]
        
        for team in playoff_teams:
            playoff_counts[team] += 1
        
        # Simulate playoffs
        # Quarter-final style: 1st vs 4th, 2nd vs 3rd (or simplified knockout)
        # IPL uses: Qualifier 1 (1st vs 2nd), Eliminator (3rd vs 4th), Qualifier 2, Final
        
        playoff_order = [t[0] for t in sorted_teams[:4]]
        
        # Qualifier 1: 1st vs 2nd (winner goes to final, loser gets another chance)
        q1_winner = simulate_match(playoff_order[0], playoff_order[1])
        q1_loser = playoff_order[1] if q1_winner == playoff_order[0] else playoff_order[0]
        
        # Eliminator: 3rd vs 4th (winner goes to Qualifier 2)
        elim_winner = simulate_match(playoff_order[2], playoff_order[3])
        
        # Qualifier 2: Q1 loser vs Eliminator winner
        q2_winner = simulate_match(q1_loser, elim_winner)
        
        # Final: Q1 winner vs Q2 winner
        champion = simulate_match(q1_winner, q2_winner)
        
        championship_counts[champion] += 1
        
        # Store points distribution
        for team in teams:
            points_distribution[team].append(sim_standings[team]['points'])
    
    return playoff_counts, championship_counts, points_distribution

# Run the simulation
print("\n" + "=" * 80)
print("RUNNING SIMULATION...")
print("=" * 80)

playoff_counts, championship_counts, points_distribution = run_simulation(iterations)

# Calculate probabilities
print("\n" + "=" * 80)
print("PLAYOFF QUALIFICATION PROBABILITIES")
print("=" * 80)
print(f"{'Team':<10s} {'Probability':<15s} {'Expected Rank':<15s} {'Points Range':<20s}")
print("-" * 80)

# Calculate expected rank and points stats
team_stats = {}
for team in teams:
    prob = playoff_counts[team] / iterations * 100
    
    # Calculate expected rank
    ranks = []
    for pts_list in zip(*[points_distribution[t] for t in teams]):
        sorted_pts = sorted(zip(teams, pts_list), key=lambda x: x[1], reverse=True)
        rank = next(i+1 for i, (t, _) in enumerate(sorted_pts) if t == team)
        ranks.append(rank)
    avg_rank = sum(ranks) / len(ranks)
    
    # Points statistics
    pts = points_distribution[team]
    min_pts = min(pts)
    max_pts = max(pts)
    avg_pts = sum(pts) / len(pts)
    
    team_stats[team] = {
        'playoff_prob': prob,
        'championship_prob': championship_counts[team] / iterations * 100,
        'avg_rank': avg_rank,
        'min_points': min_pts,
        'max_points': max_pts,
        'avg_points': avg_pts
    }
    
    print(f"{team:<10s} {prob:>6.1f}%      {'{:.1f}'.format(avg_rank):<15s} {min_pts}-{max_pts} (avg: {avg_pts:.1f})")

# Sort by playoff probability
sorted_playoff = sorted(team_stats.items(), key=lambda x: x[1]['playoff_prob'], reverse=True)

print("\n" + "=" * 80)
print("CHAMPIONSHIP WIN PROBABILITIES")
print("=" * 80)
print(f"{'Rank':<6s} {'Team':<10s} {'Probability':<15s} {'Playoff Prob':<15s}")
print("-" * 80)

for i, (team, stats) in enumerate(sorted_playoff):
    print(f"{i+1:<6d} {team:<10s} {stats['championship_prob']:>6.1f}%      {stats['playoff_prob']:>6.1f}%")

# Detailed analysis
print("\n" + "=" * 80)
print("DETAILED TEAM ANALYSIS")
print("=" * 80)

for team, stats in sorted_playoff:
    print(f"\n{team.upper()}")
    print(f"  Current Points: {standings[team]['points']}")
    print(f"  Current NRR: {standings[team]['nrr']:+.3f}")
    print(f"  Team Rating: {ratings[team]}")
    print(f"  Matches Remaining: {remaining_matches[team]}")
    print(f"  Playoff Probability: {stats['playoff_prob']:.1f}%")
    print(f"  Championship Probability: {stats['championship_prob']:.1f}%")
    print(f"  Expected Final Rank: {stats['avg_rank']:.1f}")
    print(f"  Projected Points Range: {stats['min_points']}-{stats['max_points']} (Average: {stats['avg_points']:.1f})")

# Summary
print("\n" + "=" * 80)
print("SUMMARY AND KEY INSIGHTS")
print("=" * 80)

# Top contenders
top_contenders = [t for t, s in sorted_playoff if s['playoff_prob'] > 50]
bubble_teams = [t for t, s in sorted_playoff if 10 <= s['playoff_prob'] <= 50]
long_shots = [t for t, s in sorted_playoff if s['playoff_prob'] < 10]

print(f"\n🏆 TOP CONTENDERS (>50% playoff chance):")
for team in top_contenders:
    print(f"   • {team}: {team_stats[team]['playoff_prob']:.1f}% playoff, {team_stats[team]['championship_prob']:.1f}% title")

print(f"\n⚡ BUBBLE TEAMS (10-50% playoff chance):")
for team in bubble_teams:
    print(f"   • {team}: {team_stats[team]['playoff_prob']:.1f}% playoff, {team_stats[team]['championship_prob']:.1f}% title")

print(f"\n🎯 LONG SHOTS (<10% playoff chance):")
for team in long_shots:
    print(f"   • {team}: {team_stats[team]['playoff_prob']:.1f}% playoff, {team_stats[team]['championship_prob']:.1f}% title")

# Save results to JSON
results = {
    "simulation_info": {
        "iterations": iterations,
        "matches_per_team": matches_per_team,
        "date": "April 18, 2026"
    },
    "playoff_probabilities": {team: f"{stats['playoff_prob']:.1f}" for team, stats in team_stats.items()},
    "championship_probabilities": {team: f"{stats['championship_prob']:.1f}" for team, stats in team_stats.items()},
    "expected_ranks": {team: f"{stats['avg_rank']:.1f}" for team, stats in team_stats.items()},
    "projected_points": {team: {"min": stats['min_points'], "max": stats['max_points'], "avg": f"{stats['avg_points']:.1f}"} for team, stats in team_stats.items()}
}

with open('ipl_2026_predictions.json', 'w') as f:
    json.dump(results, f, indent=2)

print("\n📊 Results saved to 'ipl_2026_predictions.json'")
print("=" * 80)
