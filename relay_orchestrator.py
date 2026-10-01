import subprocess
import time
import os
import sys

# Ranked Models from Benchmark Hierarchy
MODELS_LADDER = [
    "nemotron-3-ultra",       # Rank 1
    "big-pickle",             # Rank 2
    "mimo-v2.6-flash",         # Rank 3
    "nemotron-3.5-lightning", # Rank 4[cite: 1]
    "longcat-2.5-preview",    # Rank 5[cite: 1]
    "ling-3.0-flash-fin",     # Rank 6[cite: 1]
    "muse-spark-1.3"          # Rank 7[cite: 1]
]

APPS = ["opencode", "cline", "workbuddy"]
TASK_PROMPT = "Inspect current project status, build missing features, fix errors, and verify with npm run build."

def verify_build_complete():
    """Checks if the project compiles cleanly."""
    res = subprocess.run(["npm", "run", "build"], shell=True, capture_output=True, text=True)
    return res.returncode == 0

def git_commit_checkpoint(app_name, model_name):
    """Saves progress before rotating tools."""
    subprocess.run(["git", "add", "."], check=False)
    subprocess.run(["git", "commit", "-m", f"relay checkpoint: {app_name} with {model_name}"], check=False)

def execute_agent_turn(app_name, model_name):
    print(f"\n=======================================================")
    print(f"[RELAY] Activating App: {app_name.upper()} | Model: {model_name}")
    print(f"=======================================================\n")

    if app_name == "opencode":
        cmd = ["opencode", "run", "--yes", "--model", model_name, TASK_PROMPT]
    elif app_name == "cline":
        # Cline headless CLI invocation
        cmd = ["npx", "cline", "--headless", "--yes", "--model", model_name, "--prompt", TASK_PROMPT]
    elif app_name == "workbuddy":
        # WorkBuddy CLI runner or headless dispatch
        cmd = ["workbuddy", "exec", "--auto", "--model", model_name, TASK_PROMPT]

    try:
        # Run agent turn with a 12-minute safety watchdog
        proc = subprocess.run(cmd, timeout=720)
        git_commit_checkpoint(app_name, model_name)
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"[WARN] {app_name} reached runtime limit. Forcing checkpoint and switching...")
        git_commit_checkpoint(app_name, model_name)
        return False
    except Exception as e:
        print(f"[ERROR] Execution failed for {app_name}: {e}")
        return False

def main():
    model_index = 0
    app_index = 0

    while model_index < len(MODELS_LADDER):
        current_model = MODELS_LADDER[model_index]
        current_app = APPS[app_index]

        # Check if the build has already succeeded
        if verify_build_complete():
            print("\n[SUCCESS] Application built and validated without errors!")
            sys.exit(0)

        # Run 1 app with 1 model
        success = execute_agent_turn(current_app, current_model)

        # Rotate to the next application in round-robin sequence
        app_index += 1
        if app_index >= len(APPS):
            app_index = 0
            # Once all 3 apps have cycled through the current model, step down to next model
            model_index += 1
            print(f"\n[INFO] Round complete. Advancing to next benchmark model: {MODELS_LADDER[min(model_index, len(MODELS_LADDER)-1)]}")

        time.sleep(3)

    print("\n[ALERT] Reached end of model hierarchy. Check build logs manually.")

if __name__ == "__main__":
    main()