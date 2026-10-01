import os
import socket
import subprocess
import sys


def main() -> int:
    host = os.getenv('API_HOST', '0.0.0.0')
    port = int(os.getenv('API_PORT', '5000'))

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, port))
        except OSError:
            print(f"Port {port} is already in use on {host}. Set API_PORT to a free port or stop the conflicting process.")
            return 1

    command = [
        sys.executable,
        '-m',
        'uvicorn',
        'backend.main:app',
        '--host',
        host,
        '--port',
        str(port),
    ]
    return subprocess.call(command)


if __name__ == '__main__':
    raise SystemExit(main())
