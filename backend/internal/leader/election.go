// Package leader implements Kubernetes Lease-based leader election for
// K6 Stratos backend singleton workers (the schedule runner and, in the
// future, any other DB-writing background ticker), per
// .cursor/rules/backend-ha-leader-election.mdc. Exactly one backend
// replica at a time runs OnStartedLeading's work; the rest sit idle but
// keep serving REST/API traffic normally (multi-active).
package leader

import (
	"context"
	"log"
	"os"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/leaderelection"
	"k8s.io/client-go/tools/leaderelection/resourcelock"
)

const lockName = "k6-stratum-portal-backend-leader"

// Run blocks until ctx is cancelled. onStartedLeading is called (with a
// context scoped to this leadership term) whenever this process becomes
// leader; onStoppedLeading is called when it loses or releases
// leadership. In local/dev environments without an in-cluster
// Kubernetes config (no ServiceAccount token mounted), it skips
// coordination entirely and treats the process as the sole leader — a
// single local instance has no one to coordinate with.
func Run(ctx context.Context, onStartedLeading func(context.Context), onStoppedLeading func()) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		log.Printf("leader: no in-cluster config (%v) — running as sole leader without coordination (expected in local/dev)", err)
		runStandalone(ctx, onStartedLeading, onStoppedLeading)
		return
	}

	clientset, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		log.Printf("leader: failed to build in-cluster client (%v) — running as sole leader without coordination", err)
		runStandalone(ctx, onStartedLeading, onStoppedLeading)
		return
	}

	namespace := os.Getenv("POD_NAMESPACE")
	if namespace == "" {
		namespace = "default"
	}
	identity := os.Getenv("HOSTNAME")
	if identity == "" {
		identity = "k6-stratum-portal-backend"
	}

	lock := &resourcelock.LeaseLock{
		LeaseMeta:  metav1.ObjectMeta{Name: lockName, Namespace: namespace},
		Client:     clientset.CoordinationV1(),
		LockConfig: resourcelock.ResourceLockConfig{Identity: identity},
	}

	leaderelection.RunOrDie(ctx, leaderelection.LeaderElectionConfig{
		Lock:            lock,
		ReleaseOnCancel: true,
		LeaseDuration:   15 * time.Second,
		RenewDeadline:   10 * time.Second,
		RetryPeriod:     2 * time.Second,
		Callbacks: leaderelection.LeaderCallbacks{
			OnStartedLeading: onStartedLeading,
			OnStoppedLeading: onStoppedLeading,
			OnNewLeader: func(currentLeader string) {
				if currentLeader != identity {
					log.Printf("leader: current leader is %s", currentLeader)
				}
			},
		},
	})
}

func runStandalone(ctx context.Context, onStartedLeading func(context.Context), onStoppedLeading func()) {
	leaderCtx, cancel := context.WithCancel(ctx)
	onStartedLeading(leaderCtx)
	<-ctx.Done()
	cancel()
	onStoppedLeading()
}
