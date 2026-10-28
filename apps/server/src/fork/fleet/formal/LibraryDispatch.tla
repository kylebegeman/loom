-------------------------- MODULE LibraryDispatch --------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Requests, MaxRestarts
VARIABLES launched, bound, sent, sendCount, cancelled, revoked, online, restarts
vars == <<launched, bound, sent, sendCount, cancelled, revoked, online, restarts>>
Init == /\ launched = {} /\ bound = {} /\ sent = {} /\ cancelled = {}
        /\ sendCount = [r \in Requests |-> 0]
        /\ revoked = FALSE /\ online = TRUE /\ restarts = 0
Launch(r) == /\ online /\ ~revoked /\ r \notin cancelled
             /\ launched' = launched \cup {r}
             /\ UNCHANGED <<bound, sent, sendCount, cancelled, revoked, online, restarts>>
Bind(r) == /\ online /\ ~revoked /\ r \in launched /\ r \notin cancelled
           /\ bound' = bound \cup {r}
           /\ UNCHANGED <<launched, sent, sendCount, cancelled, revoked, online, restarts>>
Send(r) == /\ online /\ ~revoked /\ r \in bound /\ r \notin cancelled /\ r \notin sent
           /\ sent' = sent \cup {r}
           /\ sendCount' = [sendCount EXCEPT ![r] = @ + 1]
           /\ UNCHANGED <<launched, bound, cancelled, revoked, online, restarts>>
Cancel(r) == /\ cancelled' = cancelled \cup {r}
             /\ UNCHANGED <<launched, bound, sent, sendCount, revoked, online, restarts>>
Revoke == /\ ~revoked /\ revoked' = TRUE
          /\ UNCHANGED <<launched, bound, sent, sendCount, cancelled, online, restarts>>
Crash == /\ online /\ restarts < MaxRestarts /\ online' = FALSE
         /\ UNCHANGED <<launched, bound, sent, sendCount, cancelled, revoked, restarts>>
Restart == /\ ~online /\ online' = TRUE /\ restarts' = restarts + 1
           /\ UNCHANGED <<launched, bound, sent, sendCount, cancelled, revoked>>
Next == (\E r \in Requests: Launch(r) \/ Bind(r) \/ Send(r) \/ Cancel(r))
        \/ Revoke \/ Crash \/ Restart
Spec == Init /\ [][Next]_vars
NoUnboundDispatch == sent \subseteq bound
AtMostOnce == \A r \in Requests: sendCount[r] <= 1
=============================================================================
