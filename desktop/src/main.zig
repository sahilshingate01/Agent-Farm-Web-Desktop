const std = @import("std");
const builtin = @import("builtin");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

/// libdispatch trampoline (macOS): async bridge replies must reach WebKit's
/// evaluateJavaScript on the MAIN thread, so controller worker threads hand
/// their finished jobs back through the main dispatch queue.
const libdispatch = struct {
    extern "c" var _dispatch_main_q: anyopaque;
    extern "c" fn dispatch_async_f(
        queue: *anyopaque,
        context: ?*anyopaque,
        work: *const fn (?*anyopaque) callconv(.c) void,
    ) void;

    fn onMain(context: ?*anyopaque, work: *const fn (?*anyopaque) callconv(.c) void) void {
        dispatch_async_f(@ptrCast(&_dispatch_main_q), context, work);
    }
};

pub const panic = std.debug.FullPanic(native_sdk.debug.capturePanic);

const bridge_origins = [_][]const u8{ "zero://app", "http://127.0.0.1:7417" };
const bridge_policies = [_]native_sdk.BridgeCommandPolicy{
    .{ .name = "farm.bootstrap", .origins = &bridge_origins },
    .{ .name = "farm.profile.save", .origins = &bridge_origins },
    .{ .name = "farm.profile.duplicate", .origins = &bridge_origins },
    .{ .name = "farm.profile.remove", .origins = &bridge_origins },
    .{ .name = "farm.profile.reorder", .origins = &bridge_origins },
    .{ .name = "farm.gateway.save", .origins = &bridge_origins },
    .{ .name = "farm.gateway.start", .origins = &bridge_origins },
    .{ .name = "farm.gateway.stop", .origins = &bridge_origins },
    .{ .name = "farm.gateway.status", .origins = &bridge_origins },
    .{ .name = "farm.farmd.start", .origins = &bridge_origins },
    .{ .name = "farm.farmd.stop", .origins = &bridge_origins },
    .{ .name = "farm.farmd.status", .origins = &bridge_origins },
    .{ .name = "farm.distributed.list", .origins = &bridge_origins },
    .{ .name = "farm.distributed.create", .origins = &bridge_origins },
    .{ .name = "farm.distributed.action", .origins = &bridge_origins },
    .{ .name = "farm.agensis.pair.start", .origins = &bridge_origins },
    .{ .name = "farm.agensis.pair.exchange", .origins = &bridge_origins },
    .{ .name = "farm.open.url", .origins = &bridge_origins },
    .{ .name = "farm.action", .origins = &bridge_origins },
    .{ .name = "farm.visual-todo.dispatch", .origins = &bridge_origins },
    .{ .name = "farm.visual-todo.status", .origins = &bridge_origins },
    .{ .name = "farm.visual-todo.todo.sync", .origins = &bridge_origins },
    .{ .name = "farm.visual-todo.todo.append", .origins = &bridge_origins },
    .{ .name = "farm.chores.list", .origins = &bridge_origins },
    .{ .name = "farm.chores.mutate", .origins = &bridge_origins },
    .{ .name = "farm.chores.settings.save", .origins = &bridge_origins },
    .{ .name = "farm.chores.attachment.add", .origins = &bridge_origins },
    .{ .name = "farm.chores.attachment.read", .origins = &bridge_origins },
    .{ .name = "farm.chores.dispatch", .origins = &bridge_origins },
    .{ .name = "farm.chores.autorun.tick", .origins = &bridge_origins },
    .{ .name = "farm.chores.sync.visual-todo", .origins = &bridge_origins },
    .{ .name = "farm.visual-todo.worker.start", .origins = &bridge_origins },
    .{ .name = "farm.terminal.open", .origins = &bridge_origins },
    .{ .name = "farm.terminal.input", .origins = &bridge_origins },
    .{ .name = "farm.terminal.resize", .origins = &bridge_origins },
    .{ .name = "farm.terminal.close", .origins = &bridge_origins },
    .{ .name = "farm.hostDirs.list", .origins = &bridge_origins },
    .{ .name = "farm.hostDirs.add", .origins = &bridge_origins },
    .{ .name = "farm.hostDirs.remove", .origins = &bridge_origins },
    .{ .name = "farm.hostDirs.reload", .origins = &bridge_origins },
    .{ .name = "farm.workspace.list", .origins = &bridge_origins },
    .{ .name = "farm.workspace.setRoot", .origins = &bridge_origins },
    .{ .name = "farm.workspace.links", .origins = &bridge_origins },
    .{ .name = "farm.workspace.fileHistory", .origins = &bridge_origins },
    .{ .name = "farm.agentic.list", .origins = &bridge_origins },
    .{ .name = "farm.agentic.read", .origins = &bridge_origins },
    .{ .name = "farm.paddock.list", .origins = &bridge_origins },
    .{ .name = "farm.paddock.prime", .origins = &bridge_origins },
    .{ .name = "farm.paddock.remove", .origins = &bridge_origins },
    .{ .name = "farm.worktree.branches", .origins = &bridge_origins },
    .{ .name = "farm.worktree.list", .origins = &bridge_origins },
    .{ .name = "farm.worktree.create", .origins = &bridge_origins },
    .{ .name = "farm.worktree.remove", .origins = &bridge_origins },
    .{ .name = "farm.worktree.merge", .origins = &bridge_origins },
    .{ .name = "farm.worktree.mergeStatus", .origins = &bridge_origins },
    .{ .name = "farm.worktree.status", .origins = &bridge_origins },
    .{ .name = "farm.worktree.graph", .origins = &bridge_origins },
    .{ .name = "farm.worktree.fetch", .origins = &bridge_origins },
    .{ .name = "farm.worktree.pull", .origins = &bridge_origins },
    .{ .name = "farm.worktree.mergeability", .origins = &bridge_origins },
    .{ .name = "farm.worktree.resolveConflict", .origins = &bridge_origins },
    .{ .name = "farm.crew.list", .origins = &bridge_origins },
    .{ .name = "farm.crew.save", .origins = &bridge_origins },
    .{ .name = "farm.crew.remove", .origins = &bridge_origins },
    .{ .name = "farm.notify", .origins = &bridge_origins },
    .{ .name = "farm.usage.ping", .origins = &bridge_origins },
    .{ .name = "farm.editor.assist", .origins = &bridge_origins },
    .{ .name = "farm.harvest.scan", .origins = &bridge_origins },
    .{ .name = "farm.harvest.triage", .origins = &bridge_origins },
    .{ .name = "farm.harvest.list", .origins = &bridge_origins },
    .{ .name = "farm.harvest.draft", .origins = &bridge_origins },
    .{ .name = "farm.harvest.resolve", .origins = &bridge_origins },
    .{ .name = "farm.workspace.read", .origins = &bridge_origins },
    .{ .name = "farm.workspace.asset", .origins = &bridge_origins },
    .{ .name = "farm.workspace.write", .origins = &bridge_origins },
    .{ .name = "farm.workspace.diff", .origins = &bridge_origins },
    .{ .name = "farm.history.list", .origins = &bridge_origins },
    .{ .name = "farm.history.mute", .origins = &bridge_origins },
    .{ .name = "farm.session.list", .origins = &bridge_origins },
    .{ .name = "farm.session.get", .origins = &bridge_origins },
    .{ .name = "farm.session.save", .origins = &bridge_origins },
    .{ .name = "farm.session.remove", .origins = &bridge_origins },
    .{ .name = "farm.session.adopt", .origins = &bridge_origins },
    .{ .name = "farm.session.peek", .origins = &bridge_origins },
    .{ .name = "farm.file.read", .origins = &bridge_origins },
};

const App = struct {
    env_map: *std.process.Environ.Map,
    io: std.Io,
    controller_path: [std.fs.max_path_bytes]u8 = undefined,
    controller_path_len: usize = 0,
    frontend_dist_path: [std.fs.max_path_bytes]u8 = undefined,
    frontend_dist_path_len: usize = 0,
    bridge_handlers: [bridge_policies.len]native_sdk.BridgeHandler = undefined,
    async_bridge_handlers: [bridge_policies.len]native_sdk.bridge.AsyncHandler = undefined,
    controller_process: ?std.process.Child = null,
    controller_reader: ?std.Io.File.Reader = null,
    controller_lock: std.Io.Mutex = .init,
    controller_read_buffer: [64 * 1024]u8 = undefined,

    fn app(self: *@This()) native_sdk.App {
        return .{
            .context = self,
            .name = "usage-farm",
            .source = native_sdk.frontend.productionSource(.{ .dist = self.frontendDist() }),
            .source_fn = source,
        };
    }

    fn source(context: *anyopaque) anyerror!native_sdk.WebViewSource {
        const self: *@This() = @ptrCast(@alignCast(context));
        return native_sdk.frontend.sourceFromEnv(self.env_map, .{
            .dist = self.frontendDist(),
            .entry = "index.html",
        });
    }

    fn controller(self: *@This()) []const u8 {
        return self.controller_path[0..self.controller_path_len];
    }

    fn frontendDist(self: *@This()) []const u8 {
        return self.frontend_dist_path[0..self.frontend_dist_path_len];
    }

    fn configureFrontend(self: *@This()) void {
        if (self.env_map.get("NATIVE_SDK_FRONTEND_ASSETS")) |assets| {
            self.frontend_dist_path_len = @min(assets.len, self.frontend_dist_path.len);
            @memcpy(self.frontend_dist_path[0..self.frontend_dist_path_len], assets[0..self.frontend_dist_path_len]);
            return;
        }
        var executable_buffer: [std.fs.max_path_bytes]u8 = undefined;
        const executable_len = std.process.executablePath(self.io, &executable_buffer) catch 0;
        if (executable_len > 0) {
            const executable = executable_buffer[0..executable_len];
            if (std.mem.indexOf(u8, executable, ".app/Contents/MacOS/") != null and std.fs.path.dirname(executable) != null) {
                const macos_dir = std.fs.path.dirname(executable).?;
                if (std.fs.path.dirname(macos_dir)) |contents_dir| {
                    const path = std.fmt.bufPrint(&self.frontend_dist_path, "{s}/Resources/frontend/dist", .{contents_dir}) catch return;
                    self.frontend_dist_path_len = path.len;
                    return;
                }
            }
            if (std.fs.path.dirname(executable)) |bin_dir| {
                if (std.fs.path.dirname(bin_dir)) |zig_out_dir| {
                    const root_dir = std.fs.path.dirname(zig_out_dir) orelse zig_out_dir;
                    const path = std.fmt.bufPrint(&self.frontend_dist_path, "{s}/frontend/dist", .{root_dir}) catch return;
                    self.frontend_dist_path_len = path.len;
                    return;
                }
            }
        }
        const development = "frontend/dist";
        self.frontend_dist_path_len = development.len;
        @memcpy(self.frontend_dist_path[0..development.len], development);
    }

    fn configureController(self: *@This()) void {
        if (self.env_map.get("USAGE_FARM_DESKTOP_CONTROLLER")) |explicit| {
            self.controller_path_len = @min(explicit.len, self.controller_path.len);
            @memcpy(self.controller_path[0..self.controller_path_len], explicit[0..self.controller_path_len]);
            return;
        }
        if (self.env_map.get("NATIVE_SDK_FRONTEND_ASSETS")) |assets| {
            const path = std.fmt.bufPrint(&self.controller_path, "{s}/backend/controller.mjs", .{assets}) catch return;
            self.controller_path_len = path.len;
            return;
        }

        var executable_buffer: [std.fs.max_path_bytes]u8 = undefined;
        const executable_len = std.process.executablePath(self.io, &executable_buffer) catch 0;
        if (executable_len > 0) {
            const executable = executable_buffer[0..executable_len];
            if (std.mem.indexOf(u8, executable, ".app/Contents/MacOS/") != null and std.fs.path.dirname(executable) != null) {
                const macos_dir = std.fs.path.dirname(executable).?;
                if (std.fs.path.dirname(macos_dir)) |contents_dir| {
                    const path = std.fmt.bufPrint(&self.controller_path, "{s}/Resources/frontend/dist/backend/controller.mjs", .{contents_dir}) catch return;
                    self.controller_path_len = path.len;
                    return;
                }
            }
        }

        const development = "frontend/public/backend/controller.mjs";
        self.controller_path_len = development.len;
        @memcpy(self.controller_path[0..development.len], development);
    }

    fn bridge(self: *@This()) native_sdk.BridgeDispatcher {
        // macOS: async handlers — the controller runs on a worker thread and
        // the reply trampolines back to the main queue, so a slow command
        // (usage ping, git fetch, wiki walk) can no longer freeze the UI.
        // The .hang/.spin reports of 2026-07-15/16 all pinned the main
        // thread inside the old synchronous invoke (poll() on node's pipe).
        if (comptime builtin.os.tag == .macos) {
            inline for (bridge_policies, 0..) |policy, index| {
                self.async_bridge_handlers[index] = .{ .name = policy.name, .context = self, .invoke_fn = invokeControllerAsync };
            }
            return .{
                .policy = .{ .enabled = true, .commands = &bridge_policies },
                .async_registry = .{ .handlers = &self.async_bridge_handlers },
            };
        }
        inline for (bridge_policies, 0..) |policy, index| {
            self.bridge_handlers[index] = .{ .name = policy.name, .context = self, .invoke_fn = invokeController };
        }
        return .{
            .policy = .{ .enabled = true, .commands = &bridge_policies },
            .registry = .{ .handlers = &self.bridge_handlers },
        };
    }

    /// One in-flight controller invocation. Owns copies of the request's
    /// transient slices (id/command/payload live in the bridge message
    /// buffer, which is gone once the script-message callback returns) and
    /// the response bytes filled in by the worker thread.
    const ControllerJob = struct {
        app: *App,
        responder: native_sdk.bridge.AsyncResponder,
        id: []u8,
        command: []u8,
        payload: []u8,
        ok: bool = false,
        output_len: usize = 0,
        output: [native_sdk.bridge.max_result_bytes]u8 = undefined,

        fn destroy(self: *@This()) void {
            const allocator = std.heap.page_allocator;
            allocator.free(self.id);
            allocator.free(self.command);
            allocator.free(self.payload);
            allocator.destroy(self);
        }
    };

    fn invokeControllerAsync(context: *anyopaque, invocation: native_sdk.bridge.Invocation, responder: native_sdk.bridge.AsyncResponder) anyerror!void {
        const self: *@This() = @ptrCast(@alignCast(context));
        const allocator = std.heap.page_allocator;
        const job = allocator.create(ControllerJob) catch |err| {
            try responder.fail(invocation.request.id, .internal_error, @errorName(err));
            return;
        };
        job.* = .{ .app = self, .responder = responder, .id = &.{}, .command = &.{}, .payload = &.{} };
        errdefer job.destroy();
        job.id = try allocator.dupe(u8, invocation.request.id);
        job.command = try allocator.dupe(u8, invocation.request.command);
        job.payload = try allocator.dupe(u8, invocation.request.payload);
        const thread = std.Thread.spawn(.{}, controllerWorker, .{job}) catch |err| {
            job.destroy();
            try responder.fail(invocation.request.id, .internal_error, @errorName(err));
            return;
        };
        thread.detach();
    }

    fn controllerWorker(job: *ControllerJob) void {
        runControllerJob(job);
        libdispatch.onMain(job, deliverControllerResponse);
    }

    fn setJobMessage(job: *ControllerJob, comptime fmt: []const u8, args: anytype) void {
        const written = std.fmt.bufPrint(&job.output, fmt, args) catch job.output[0..0];
        job.output_len = written.len;
    }

    fn runControllerJob(job: *ControllerJob) void {
        const self = job.app;
        const result = std.process.run(std.heap.page_allocator, self.io, .{
            .argv = &.{ "node", self.controller(), job.command, job.payload },
            .stdout_limit = .limited(job.output.len),
            .stderr_limit = .limited(4096),
        }) catch |err| {
            // StreamTooLong is the collector hitting stdout_limit/stderr_limit
            // after a successful spawn — not a launch failure.
            if (err == error.StreamTooLong) {
                setJobMessage(job, "controller response too large", .{});
            } else {
                setJobMessage(job, "controller failed to start: {s}", .{@errorName(err)});
            }
            return;
        };
        defer std.heap.page_allocator.free(result.stdout);
        defer std.heap.page_allocator.free(result.stderr);
        if (result.term != .exited or result.term.exited != 0) {
            const detail = std.mem.trim(u8, result.stderr, " \t\r\n");
            job.output_len = @min(detail.len, job.output.len);
            @memcpy(job.output[0..job.output_len], detail[0..job.output_len]);
            if (job.output_len == 0) setJobMessage(job, "controller exited with an error", .{});
            return;
        }
        if (result.stdout.len > job.output.len) {
            setJobMessage(job, "controller response too large", .{});
            return;
        }
        @memcpy(job.output[0..result.stdout.len], result.stdout);
        job.output_len = result.stdout.len;
        job.ok = true;
    }

    fn deliverControllerResponse(context: ?*anyopaque) callconv(.c) void {
        const job: *ControllerJob = @ptrCast(@alignCast(context orelse return));
        defer job.destroy();
        // A failed respond means the webview went away mid-flight — nothing
        // left to tell.
        if (job.ok) {
            job.responder.success(job.id, job.output[0..job.output_len]) catch {};
        } else {
            job.responder.fail(job.id, .internal_error, job.output[0..job.output_len]) catch {};
        }
    }

    fn invokeController(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
        const self: *@This() = @ptrCast(@alignCast(context));
        const result = try std.process.run(std.heap.page_allocator, self.io, .{
            .argv = &.{ "node", self.controller(), invocation.request.command, invocation.request.payload },
            .stdout_limit = .limited(output.len),
            .stderr_limit = .limited(4096),
        });
        defer std.heap.page_allocator.free(result.stdout);
        defer std.heap.page_allocator.free(result.stderr);
        if (result.term != .exited or result.term.exited != 0) return error.ControllerFailed;
        if (result.stdout.len > output.len) return error.ResponseTooLarge;
        @memcpy(output[0..result.stdout.len], result.stdout);
        return output[0..result.stdout.len];
    }
};

const dev_origins = [_][]const u8{ "zero://app", "zero://inline", "http://127.0.0.1:7417" };

pub fn main(init: std.process.Init) !void {
    var app = App{ .env_map = init.environ_map, .io = init.io };
    app.configureFrontend();
    app.configureController();
    try runner.runWithOptions(app.app(), .{
        .app_name = "Agensis Farm",
        .window_title = "Agensis Farm",
        .bundle_id = "dev.usage-farm.desktop",
        .icon_path = "assets/icon.png",
        .bridge = app.bridge(),
        .security = .{
            .navigation = .{ .allowed_origins = &dev_origins },
        },
    }, init);
}

test "bridge exposes the desktop command surface" {
    try std.testing.expectEqual(@as(usize, 85), bridge_policies.len);
    try std.testing.expectEqualStrings("farm.bootstrap", bridge_policies[0].name);
}
