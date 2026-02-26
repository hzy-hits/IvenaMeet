.PHONY: bootstrap-host cleanup-orphan-avatars init-db

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
