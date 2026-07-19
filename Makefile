# SavePoint dev/demo stack. Targets are independent — run whichever you need,
# each in its own terminal if it's long-running. See docs/DEV.md / docs/DEPLOY.md
# for the underlying manual commands.
#
#   make deploy-pi   sync the Pi's edge/ checkout to this machine's branch@commit, restart the service
#   make backend     run the backend (foreground) on 0.0.0.0:$(BACKEND_PORT)
#   make frontend    run the frontend (foreground) on 0.0.0.0:$(FRONTEND_PORT)
#   make down        free the backend + frontend ports
#
# Override on the command line, e.g. `make deploy-pi PI_HOST=pi@100.x.x.x`.

PI_HOST       ?= pi@100.105.91.22
PI_REPO       ?= /home/pi/ht6-savepoint
PI_SERVICE    ?= savepoint-edge
BACKEND_PORT  ?= 8000
FRONTEND_PORT ?= 5173

BRANCH := $(shell git rev-parse --abbrev-ref HEAD)
COMMIT := $(shell git rev-parse HEAD)
UPSTREAM_COMMIT := $(shell git rev-parse origin/$(BRANCH) 2>/dev/null)

.PHONY: help deploy-pi backend frontend down

help:
	@echo "make deploy-pi   sync Pi's edge/ checkout to $(BRANCH)@$$(git rev-parse --short HEAD), restart $(PI_SERVICE)"
	@echo "make backend     run backend on 0.0.0.0:$(BACKEND_PORT) (foreground)"
	@echo "make frontend    run frontend on 0.0.0.0:$(FRONTEND_PORT) (foreground)"
	@echo "make down        free ports $(BACKEND_PORT) and $(FRONTEND_PORT)"

# Forces the Pi's checkout to the exact commit this machine is on. Requires
# that commit to already be pushed (the Pi fetches from origin, not from us).
deploy-pi:
	@if [ "$(COMMIT)" != "$(UPSTREAM_COMMIT)" ]; then \
		echo "!! local $(BRANCH) ($(COMMIT)) != origin/$(BRANCH) ($(UPSTREAM_COMMIT))"; \
		echo "   push first -- the Pi can only fetch commits that exist on origin."; \
		exit 1; \
	fi
	@echo "==> syncing $(PI_HOST) to $(BRANCH)@$$(git rev-parse --short HEAD)"
	@ssh $(PI_HOST) '\
		set -e; cd $(PI_REPO); \
		before=$$(git rev-parse HEAD); \
		git fetch origin --quiet; \
		git checkout -B $(BRANCH) origin/$(BRANCH) --quiet; \
		git reset --hard $(COMMIT) --quiet; \
		after=$$(git rev-parse HEAD); \
		echo "    $$before -> $$after"; \
		if [ "$$before" != "$$after" ]; then \
			if sudo -n systemctl restart $(PI_SERVICE) 2>/dev/null; then \
				echo "    restarted $(PI_SERVICE)"; \
			else \
				echo "    !! sudo needs a password on the Pi -- restart by hand:"; \
				echo "       ssh $(PI_HOST) sudo systemctl restart $(PI_SERVICE)"; \
			fi; \
		else \
			echo "    already at that commit, $(PI_SERVICE) left running"; \
		fi; \
		systemctl is-active $(PI_SERVICE)'

backend:
	cd server && uv run uvicorn savepoint_server.main:app --host 0.0.0.0 --port $(BACKEND_PORT)

frontend:
	cd app && pnpm dev --host 0.0.0.0 --port $(FRONTEND_PORT)

down:
	-fuser -k $(BACKEND_PORT)/tcp
	-fuser -k $(FRONTEND_PORT)/tcp
