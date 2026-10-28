import os
import sys

if __name__ == '__main__':
    # Launch the Chennai Transit Web GIS viewer
    viewer_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ChennaiGTFS', 'run_viewer.py')
    if os.path.exists(viewer_script):
        # On Windows, spawn python directly
        import subprocess
        try:
            subprocess.run([sys.executable, viewer_script] + sys.argv[1:])
        except KeyboardInterrupt:
            pass
    else:
        print(f"Error: {viewer_script} not found.")
