import subprocess
import time
import sys
import shutil

# OpenCode Zen benchmark hierarchy
MODELS_LADDER = [
    "opencode/nemotron-3-ultra-free",
    "opencode/big-pickle",
    "opencode/mimo-v2.6-flash-free",
    "opencode/nemotron-3.5-lightning-free",
    "opencode/longcat-2.5-preview-free",
    "opencode/ling-3.0-flash-fin-free",
    "opencode/muse-spark-1.3-free"
]

TASK_PROMPT = (
    "Build and implement the required features for this application. "
    "Do not stop to ask for confirmation. Fix any errors, make the necessary file "
    "changes, and ensure all parts of the application are working."
)

def git_checkpoint(model_name):
    """Saves progress to Git using conventional commits and bypassing pre-commit hooks."""
    subprocess.run(["git", "add", "."], check=False)
    subprocess.run([
        "git", "commit",
        "--no-verify",
        "-m", f"chore(relay): automated build iteration with {model_name}"
    ], check=False)

def run_model_turn(model_name):
    print("\n" + "=" * 60)
    print(f"[RELAY] Active Model: {model_name}")
    print("=" * 60 + "\n")

    cmd = [
        "opencode", "run",
        "--auto",
        "--model", model_name,
        TASK_PROMPT
    ]

    try:
        # 12-minute execution cycle before checking and rotating
        proc = subprocess.run(cmd, timeout=720)
        git_checkpoint(model_name)
        return proc.returncode == 0
    except subprocess.TimeoutExpired:
        print(f"\n[WARN] Timeout reached for {model_name}. Preserving progress and rotating...")
        git_checkpoint(model_name)
        return False
    except Exception as err:
        print(f"\n[ERROR] Encountered error with {model_name}: {err}")
        return False

def main():
    if not shutil.which("opencode"):
        print("[FATAL] 'opencode' binary not found in your PATH.")
        sys.exit(1)

    print("[RELAY] Initiating autonomous build loop across OpenCode models...")

    for index, model in enumerate(MODELS_LADDER, start=1):
        print(f"\n>>> Step {index}/{len(MODELS_LADDER)}: Running {model} <<<")
        run_model_turn(model)
        print(f"\n[RELAY] Session for {model} completed or limit reached. Advancing to next rank...")
        time.sleep(3)

    print("\n[NOTICE] Finished full cycle across all free benchmark models.")

if __name__ == "__main__":
    main()
