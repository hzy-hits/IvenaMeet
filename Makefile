.PHONY: bootstrap-host cleanup-orphan-avatars init-db rotate-admin-token rotate-admin-token-auto

bootstrap-host:
	@if { [ -z "$$BOOTSTRAP_ADMIN_TOKEN" ] && [ -z "$$ADMIN_TOKEN" ]; } || [ -z "$$ROOM_ID" ] || [ -z "$$HOST_IDENTITY" ]; then \
		echo "usage: BOOTSTRAP_ADMIN_TOKEN=... ROOM_ID=test HOST_IDENTITY=alice_host make bootstrap-host"; \
		echo "       (legacy fallback: ADMIN_TOKEN=... still works)"; \
		exit 2; \
	fi
	@./scripts/bootstrap-host.sh

cleanup-orphan-avatars:
	@./scripts/cleanup-orphan-avatars.sh

init-db:
	@./scripts/init-db.sh

rotate-admin-token:
	@if [ -z "$$NEW_TOKEN" ]; then \
		echo "usage: NEW_TOKEN=... make rotate-admin-token [ENV_FILE=.env] [RESTART_AFTER=1]"; \
		exit 2; \
	fi
	@NEW_TOKEN="$$NEW_TOKEN" ENV_FILE="$${ENV_FILE:-}" RESTART_AFTER="$${RESTART_AFTER:-1}" ./scripts/rotate-admin-token.sh

rotate-admin-token-auto:
	@ENV_FILE="$${ENV_FILE:-}" RESTART_AFTER="$${RESTART_AFTER:-1}" AUTO_GENERATE=1 ./scripts/rotate-admin-token.sh --auto-generate
