package sg.crewsafe.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import sg.crewsafe.entity.ActionDispatch;

import java.util.List;
import java.util.UUID;

@Repository
public interface ActionDispatchRepository extends JpaRepository<ActionDispatch, UUID> {
    List<ActionDispatch> findByWorkerIdOrderByDispatchedAtDesc(UUID workerId);
    List<ActionDispatch> findByApprovalIdOrderByDispatchedAtDesc(UUID approvalId);
}
